package update

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setup(t *testing.T) Paths {
	dir := t.TempDir()
	paths := Paths{Binary: filepath.Join(dir, "wg-admin-agent"), Marker: filepath.Join(dir, "state", ".agent-update")}
	_ = os.WriteFile(paths.Binary, []byte("OLD"), 0o755)

	return paths
}

func sum(data string) string {
	hash := sha256.Sum256([]byte(data))

	return hex.EncodeToString(hash[:])
}

func read(path string) string {
	data, _ := os.ReadFile(path)

	return string(data)
}

func TestInstallVerifiesHash(t *testing.T) {
	paths := setup(t)

	if err := Install(paths, strings.NewReader("NEW"), sum("OTHER")); err == nil {
		t.Fatal("подменённый бинарь не устанавливается")
	}
	if read(paths.Binary) != "OLD" {
		t.Fatal("текущий бинарь не тронут")
	}

	if err := Install(paths, strings.NewReader("NEW"), sum("NEW")); err != nil {
		t.Fatal(err)
	}
	if read(paths.Binary) != "NEW" || read(paths.Binary+".prev") != "OLD" {
		t.Fatal("новый на месте, прежний сохранён")
	}

	info, _ := os.Stat(paths.Binary)
	if info.Mode().Perm()&0o100 == 0 {
		t.Fatal("новый бинарь исполняемый")
	}
}

func TestRollbackAfterFailedBoots(t *testing.T) {
	paths := setup(t)
	_ = Install(paths, strings.NewReader("NEW"), sum("NEW"))

	for i := 0; i < MaxBootAttempts; i++ {
		if rolled, err := Boot(paths); err != nil || rolled {
			t.Fatalf("запуск %d: отката ещё нет (%v)", i+1, err)
		}
	}

	rolled, err := Boot(paths)
	if err != nil || !rolled {
		t.Fatal("после трёх запусков без связи — откат")
	}
	if read(paths.Binary) != "OLD" {
		t.Fatal("вернулся прежний бинарь")
	}
	if rolled, _ := Boot(paths); rolled {
		t.Fatal("после отката маркера нет")
	}
}

func TestHealthyKeepsNewVersion(t *testing.T) {
	paths := setup(t)
	_ = Install(paths, strings.NewReader("NEW"), sum("NEW"))

	_, _ = Boot(paths)
	Healthy(paths)

	for i := 0; i < MaxBootAttempts+1; i++ {
		if rolled, _ := Boot(paths); rolled {
			t.Fatal("вышел на связь — отката нет")
		}
	}
	if read(paths.Binary) != "NEW" {
		t.Fatal("новая версия остаётся")
	}
}

func TestFileHash(t *testing.T) {
	paths := setup(t)

	if got, _ := FileHash(paths.Binary); got != sum("OLD") {
		t.Fatal(got)
	}
}
