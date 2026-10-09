package main

import (
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sync"
	"time"

	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/state"
	"wgadmin/agent/internal/wg"
)

// dryEgress — интерфейс выхода в конфигах имитации.
const dryEgress = "eth0"

// drySystem — имитация узла (WG_DRY_RUN=1): ни одной системной команды,
// файлы — только конфиги для наглядности и файл состояния в своих каталогах.
// Применение всегда успешно, метрики и пробы — синтетические.
type drySystem struct {
	configDir string
	stateFile string
	started   time.Time

	mu      sync.Mutex
	applied desired.State
}

func newDrySystem(configDir, stateDir string) *drySystem {
	return &drySystem{configDir: configDir, stateFile: filepath.Join(stateDir, "state.json"), started: time.Now()}
}

func (s *drySystem) Ready() error { return nil }

func (s *drySystem) Info() HostInfo {
	return HostInfo{WgVersion: "dry-run", WgMode: "userspace", UDPPorts: []int{}, TCPPorts: []int{}}
}

func (s *drySystem) Apply(target desired.State, health *failover.Health) apply.Result {
	owned := state.LoadOwned(s.stateFile)
	result := apply.Result{Interfaces: []desired.InterfaceStatus{}, Errors: []string{}}

	if err := os.MkdirAll(s.configDir, 0o700); err != nil {
		result.Errors = append(result.Errors, "каталог конфигов: "+err.Error())
	}

	want := map[string]bool{}
	for _, iface := range target.Interfaces {
		want[iface.Name] = true
	}
	for name := range owned.Fingerprints {
		if !want[name] {
			_ = os.Remove(apply.ConfPath(s.configDir, name))
			delete(owned.Fingerprints, name)
		}
	}

	for _, iface := range target.Interfaces {
		file := apply.ConfPath(s.configDir, iface.Name)
		rendered := []byte(wg.RenderConfig(iface, dryEgress))

		if _, ours := owned.Fingerprints[iface.Name]; !ours {
			existing, err := os.ReadFile(file)
			if err := apply.ForeignConfig(iface.Name, existing, err == nil, rendered, false); err != nil {
				result.Errors = append(result.Errors, iface.Name+": "+err.Error())
				result.Interfaces = append(result.Interfaces, desired.InterfaceStatus{Name: iface.Name, Status: "error", Message: err.Error()})

				continue
			}
		}
		if err := os.WriteFile(file, rendered, 0o600); err != nil {
			result.Errors = append(result.Errors, iface.Name+": "+err.Error())
			result.Interfaces = append(result.Interfaces, desired.InterfaceStatus{Name: iface.Name, Status: "error", Message: err.Error()})

			continue
		}
		owned.Fingerprints[iface.Name] = wg.Fingerprint(iface, dryEgress)

		status := "down"
		if iface.Enabled {
			status = "up"
		}
		result.Interfaces = append(result.Interfaces, desired.InterfaceStatus{Name: iface.Name, Status: status})
	}

	owned.Tunnels = []string{}
	for _, tunnel := range target.Tunnels {
		owned.Tunnels = append(owned.Tunnels, tunnel.Name)
	}
	result.Routes = apply.Routes(failover.Resolve(target.Forwards, health))

	if err := state.SaveOwned(s.stateFile, owned); err != nil {
		result.Errors = append(result.Errors, "состояние воркера: "+err.Error())
	}

	s.mu.Lock()
	s.applied = target
	s.mu.Unlock()
	logx.Info("Имитация: применена конфигурация v%d (интерфейсов %d, туннелей %d, пробросов %d)",
		target.Version, len(target.Interfaces), len(target.Tunnels), len(target.Forwards))

	return result
}

func (s *drySystem) Restart(name string) error {
	if _, ours := state.LoadOwned(s.stateFile).Fingerprints[name]; !ours {
		return errors.New("интерфейс " + name + " не создан воркером")
	}
	logx.Info("Имитация: перезапуск интерфейса %s", name)

	return nil
}

func (s *drySystem) Cleanup() {
	for name := range state.LoadOwned(s.stateFile).Fingerprints {
		_ = os.Remove(apply.ConfPath(s.configDir, name))
	}
	_ = os.Remove(s.stateFile)

	s.mu.Lock()
	s.applied = desired.State{}
	s.mu.Unlock()
	logx.Info("Имитация: созданное воркером убрано")
}

// Dump — пиры включённых интерфейсов: счётчики растут со временем работы
// воркера, рукопожатие — только что.
func (s *drySystem) Dump(names []string) []desired.InterfaceStats {
	s.mu.Lock()
	applied := s.applied
	s.mu.Unlock()

	elapsed := int64(time.Since(s.started).Seconds()) + 1
	now := time.Now().Unix()
	dump := wg.Dump{}

	for _, iface := range applied.Interfaces {
		if !iface.Enabled {
			continue
		}

		peers := []desired.PeerStat{}
		for i, peer := range iface.Peers {
			handshake := now
			endpoint := fmt.Sprintf("203.0.113.%d:51820", i%254+1)
			weight := int64(i + 1)
			peers = append(peers, desired.PeerStat{
				PublicKey:     peer.PublicKey,
				RxBytes:       elapsed * 2048 * weight,
				TxBytes:       elapsed * 8192 * weight,
				LastHandshake: &handshake,
				Endpoint:      &endpoint,
			})
		}
		dump[iface.Name] = peers
	}

	return pickInterfaces(dump, names)
}

// rtt — задержка 1–5 мс, постоянная для имени.
func rtt(name string) *float64 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(name))
	value := 1 + float64(h.Sum32()%41)/10

	return &value
}

func (s *drySystem) ProbeTunnels(tunnels []desired.Tunnel) []desired.TunnelProbe {
	result := []desired.TunnelProbe{}
	mtuOk := true

	for _, tunnel := range tunnels {
		result = append(result, desired.TunnelProbe{Name: tunnel.Name, RttMs: rtt(tunnel.Name), MtuOk: &mtuOk})
	}

	return result
}

func (s *drySystem) ProbeIPs(ips []string) map[string]bool {
	result := map[string]bool{}
	for _, ip := range ips {
		result[ip] = true
	}

	return result
}

func (s *drySystem) ProbeNodes(targets []desired.ProbeTarget) []desired.NodeProbe {
	result := []desired.NodeProbe{}
	for _, target := range targets {
		result = append(result, desired.NodeProbe{NodeID: target.NodeID, RttMs: rtt(target.Host)})
	}

	return result
}
