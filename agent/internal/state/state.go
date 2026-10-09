// Package state — что воркер создал на узле: отпечатки interface-секций его
// интерфейсов и имена его туннелей. Формат файла фиксирован: его смена
// сбросит состояние при обновлении воркера.
package state

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Owned — что воркер создал на узле.
type Owned struct {
	// Fingerprints — отпечатки interface-секций интерфейсов воркера; пустой
	// отпечаток — конфиг записан, интерфейс ещё не поднимался.
	Fingerprints map[string]string `json:"fingerprints"`
	// Tunnels — имена созданных туннелей.
	Tunnels []string `json:"tunnels"`
}

// LoadOwned — состояние; нет файла или он битый — пустое.
func LoadOwned(path string) Owned {
	owned := Owned{Fingerprints: map[string]string{}, Tunnels: []string{}}

	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &owned)
	}
	if owned.Fingerprints == nil {
		owned.Fingerprints = map[string]string{}
	}
	if owned.Tunnels == nil {
		owned.Tunnels = []string{}
	}

	return owned
}

// SaveOwned — сохранить состояние: через временный файл (0600), незавершённый
// файл не попадёт на место прежнего.
func SaveOwned(path string, owned Owned) error {
	data, err := json.MarshalIndent(owned, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}

	return os.Rename(tmp, path)
}
