// Package update — самообновление бинаря агента с откатом: новая версия,
// не вышедшая на связь за несколько запусков, заменяется прежней.
package update

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// MaxBootAttempts — запусков новой версии без связи с бэкендом до отката.
const MaxBootAttempts = 3

// Pending — незавершённое обновление: ждёт первой связи с бэкендом.
type Pending struct {
	Hash     string `json:"hash"`
	Attempts int    `json:"attempts"`
}

// FileHash — sha256 файла (hex).
func FileHash(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

// Paths — файлы обновления рядом с бинарём и в каталоге состояния.
type Paths struct {
	// Binary — выполняемый бинарь агента.
	Binary string
	// Marker — файл незавершённого обновления.
	Marker string
}

func (p Paths) previous() string { return p.Binary + ".prev" }

func (p Paths) incoming() string { return p.Binary + ".new" }

// Install — скачанный бинарь (source) проверяется по sha256 и атомарно
// заменяет текущий; прежний сохраняется для отката. После Install процесс
// должен завершиться — supervisor (systemd, docker) запустит новую версию.
func Install(paths Paths, source io.Reader, expectedHash string) error {
	if expectedHash == "" {
		return errors.New("не передан ожидаемый sha256 бинаря")
	}

	tmp, err := os.OpenFile(paths.incoming(), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}

	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(tmp, hash), source)
	syncErr := tmp.Sync()
	closeErr := tmp.Close()

	if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
		_ = os.Remove(paths.incoming())

		return fmt.Errorf("загрузка бинаря: %w", err)
	}
	if got := hex.EncodeToString(hash.Sum(nil)); got != expectedHash {
		_ = os.Remove(paths.incoming())

		return fmt.Errorf("бинарь не совпадает с ожидаемым sha256 (%s…)", got[:12])
	}

	if err := copyFile(paths.Binary, paths.previous()); err != nil {
		_ = os.Remove(paths.incoming())

		return fmt.Errorf("копия прежней версии: %w", err)
	}
	if err := writeMarker(paths.Marker, Pending{Hash: expectedHash}); err != nil {
		return err
	}

	// rename подменяет файл атомарно; работающий процесс держит старый inode.
	return os.Rename(paths.incoming(), paths.Binary)
}

// Boot — проверка при старте: незавершённое обновление, не вышедшее на связь
// MaxBootAttempts раз, откатывается на прежний бинарь. true — откат сделан,
// процессу нужно перезапуститься (новый бинарь уже на месте прежнего).
func Boot(paths Paths) (rolledBack bool, err error) {
	pending, ok := readMarker(paths.Marker)
	if !ok {
		return false, nil
	}

	if pending.Attempts >= MaxBootAttempts {
		if _, statErr := os.Stat(paths.previous()); statErr != nil {
			_ = os.Remove(paths.Marker)

			return false, nil
		}
		if err := os.Rename(paths.previous(), paths.Binary); err != nil {
			return false, err
		}
		_ = os.Remove(paths.Marker)

		return true, nil
	}

	pending.Attempts++

	return false, writeMarker(paths.Marker, pending)
}

// Healthy — новая версия вышла на связь: откат больше не нужен.
func Healthy(paths Paths) {
	if _, ok := readMarker(paths.Marker); ok {
		_ = os.Remove(paths.Marker)
	}
}

func readMarker(path string) (Pending, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Pending{}, false
	}

	var pending Pending
	if json.Unmarshal(data, &pending) != nil {
		return Pending{}, false
	}

	return pending, true
}

func writeMarker(path string, pending Pending) error {
	data, _ := json.Marshal(pending)
	tmp := path + ".tmp"

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}

	return os.Rename(tmp, path)
}

func copyFile(from, to string) error {
	source, err := os.Open(from)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.OpenFile(to+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		target.Close()

		return err
	}
	if err := target.Close(); err != nil {
		return err
	}

	return os.Rename(to+".tmp", to)
}
