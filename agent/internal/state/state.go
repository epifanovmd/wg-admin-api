// Package state — файлы агента: его состояние (что он создал на хосте) и
// последнее применённое желаемое состояние. Формат фиксирован: его смена
// сбросит состояние при обновлении агента.
package state

import (
	"encoding/json"
	"os"

	"wgadmin/agent/internal/protocol"
)

// Owned — что агент создал на хосте.
type Owned struct {
	// Fingerprints — отпечатки interface-секций применённых интерфейсов.
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

// writeAtomic — запись через временный файл (0600): незавершённый файл не
// попадёт на место прежнего.
func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"

	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}

	return os.Rename(tmp, path)
}

// SaveOwned — сохранить состояние.
func SaveOwned(path string, owned Owned) error {
	data, err := json.MarshalIndent(owned, "", "  ")
	if err != nil {
		return err
	}

	return writeAtomic(path, data)
}

// SaveDesired — последнее применённое желаемое состояние (0600: приватные
// ключи). Команды не сохраняются: повторять их при старте нельзя.
func SaveDesired(path string, desired protocol.DesiredState) error {
	desired.Commands = []protocol.Command{}

	data, err := json.Marshal(desired)
	if err != nil {
		return err
	}

	return writeAtomic(path, data)
}

// LoadDesired — сохранённое состояние или nil (нет, битое, чужой формат).
func LoadDesired(path string) *protocol.DesiredState {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	var raw map[string]json.RawMessage
	if json.Unmarshal(data, &raw) != nil {
		return nil
	}
	for _, key := range []string{"version", "interfaces", "tunnels", "forwards"} {
		if _, ok := raw[key]; !ok {
			return nil
		}
	}

	var desired protocol.DesiredState
	if json.Unmarshal(data, &desired) != nil {
		return nil
	}
	desired.Commands = []protocol.Command{}

	return &desired
}
