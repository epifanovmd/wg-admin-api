package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileFormat(t *testing.T) {
	// Формат файла фиксирован: его смена сбросила бы состояние при
	// обновлении воркера.
	stateFile := filepath.Join(t.TempDir(), "state.json")
	_ = os.WriteFile(stateFile, []byte(`{"fingerprints":{"wg0":"[\"10.0.0.1/24\",null,51820,null,true,null,null,\"eth0\"]"},"tunnels":["wgt0"]}`), 0o600)

	owned := LoadOwned(stateFile)
	if owned.Tunnels[0] != "wgt0" || owned.Fingerprints["wg0"] == "" {
		t.Fatalf("%+v", owned)
	}
}

func TestSaveAndLoad(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "sub", "state.json")

	if owned := LoadOwned(stateFile); owned.Fingerprints == nil || owned.Tunnels == nil {
		t.Fatal("нет файла — пустое состояние")
	}

	if err := SaveOwned(stateFile, Owned{Fingerprints: map[string]string{"wg0": "x"}, Tunnels: []string{"wgt1"}}); err != nil {
		t.Fatal(err)
	}

	info, _ := os.Stat(stateFile)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("права %v", info.Mode().Perm())
	}

	owned := LoadOwned(stateFile)
	if owned.Fingerprints["wg0"] != "x" || owned.Tunnels[0] != "wgt1" {
		t.Fatalf("%+v", owned)
	}

	_ = os.WriteFile(stateFile, []byte("{"), 0o600)
	if owned := LoadOwned(stateFile); len(owned.Fingerprints) != 0 {
		t.Fatal("битый файл — пустое состояние")
	}
}
