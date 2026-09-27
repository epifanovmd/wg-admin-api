package state

import (
	"os"
	"path/filepath"
	"testing"

	"wgadmin/agent/internal/protocol"
)

func TestDesiredRoundTripWithoutCommands(t *testing.T) {
	file := filepath.Join(t.TempDir(), ".wg-admin-desired.json")
	desired := protocol.DesiredState{
		Version:    7,
		Interfaces: []protocol.Interface{{Name: "wg0", PrivateKey: "PRIV", ListenPort: 51820}},
		Tunnels:    []protocol.Tunnel{},
		Forwards:   []protocol.Forward{},
		Commands:   []protocol.Command{{ID: "c1", Type: "shell"}},
	}

	if err := SaveDesired(file, desired); err != nil {
		t.Fatal(err)
	}

	info, _ := os.Stat(file)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("права %v — там приватные ключи", info.Mode().Perm())
	}

	loaded := LoadDesired(file)
	if loaded == nil || loaded.Version != 7 || loaded.Interfaces[0].PrivateKey != "PRIV" {
		t.Fatalf("%+v", loaded)
	}
	if len(loaded.Commands) != 0 {
		t.Fatal("команды при старте повторять нельзя")
	}
}

func TestLoadDesiredRejectsGarbage(t *testing.T) {
	dir := t.TempDir()

	if LoadDesired(filepath.Join(dir, "none.json")) != nil {
		t.Fatal("нет файла")
	}

	bad := filepath.Join(dir, "bad.json")
	_ = os.WriteFile(bad, []byte(`{"version":1}`), 0o600)
	if LoadDesired(bad) != nil {
		t.Fatal("чужой формат")
	}
}

func TestFileFormat(t *testing.T) {
	// Имена и формат файлов фиксированы: их смена сбросила бы состояние при
	// обновлении агента.
	dir := t.TempDir()
	stateFile := filepath.Join(dir, ".wg-admin-state.json")
	_ = os.WriteFile(stateFile, []byte(`{"fingerprints":{"wg0":"[\"10.0.0.1/24\",null,51820,null,true,null,null,\"eth0\"]"},"tunnels":["wgt0"]}`), 0o600)

	owned := LoadOwned(stateFile)
	if owned.Tunnels[0] != "wgt0" || owned.Fingerprints["wg0"] == "" {
		t.Fatalf("%+v", owned)
	}

	desiredFile := filepath.Join(dir, ".wg-admin-desired.json")
	_ = os.WriteFile(desiredFile, []byte(`{"version":42,"nodeId":"n","nodeName":"relay","interfaces":[],"tunnels":[{"name":"wgt0","remoteHost":"203.0.113.20","localTunnelIp":"10.99.0.1","remoteTunnelIp":"10.99.0.2","prefix":30,"mtu":1480}],"forwards":[{"id":"f1","proto":"udp","listenPort":51820,"targetIp":"10.99.0.2","targetPort":51820,"fallbackIp":"203.0.113.20","route":"auto","tunnel":"wgt0"}],"socks":[],"commands":[],"settings":{"statsIntervalMs":2000}}`), 0o600)

	desired := LoadDesired(desiredFile)
	if desired == nil || desired.Version != 42 || *desired.Forwards[0].Tunnel != "wgt0" {
		t.Fatalf("%+v", desired)
	}
}
