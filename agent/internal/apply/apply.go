// Package apply — приведение ноды к желаемому состоянию.
package apply

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/netcfg"
	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/shell"
	"wgadmin/agent/internal/state"
	"wgadmin/agent/internal/sysinfo"
	"wgadmin/agent/internal/wg"
)

const wgQuickTimeout = 60 * time.Second

// Socks — прокси агента (применяются вместе с остальным).
type Socks interface {
	Apply(configs []protocol.Socks) []string
}

// Result — итог применения.
type Result struct {
	// ApplyError — nil, если всё применилось.
	ApplyError *string
	Interfaces []protocol.InterfaceStatus
	Routes     []protocol.ForwardStatus
}

// Applier применяет состояние последовательно (конфиг-цикл, переключение
// маршрута и откат не пересекаются) и помнит последние пробросы.
type Applier struct {
	mu        sync.Mutex
	configDir string
	stateFile string
	socks     Socks
	applied   []failover.Resolved
	lookup    func(string) string
}

// New — применятор для каталога конфигов.
func New(configDir, stateFile string, socks Socks) *Applier {
	return &Applier{configDir: configDir, stateFile: stateFile, socks: socks, lookup: failover.LookupIPv4}
}

// Lock — занять применятор (откат при остановке ждёт текущее применение).
func (a *Applier) Lock() { a.mu.Lock() }

// Unlock — освободить.
func (a *Applier) Unlock() { a.mu.Unlock() }

func (a *Applier) confPath(name string) string {
	return filepath.Join(a.configDir, name+".conf")
}

// Apply — конфиги интерфейсов (атомарно, 0600), wg-quick up/down, `wg
// syncconf` для пиров, туннели и пробросы. Ошибки отдельных интерфейсов не
// прерывают остальные.
func (a *Applier) Apply(desired protocol.DesiredState, health *failover.Health) Result {
	a.mu.Lock()
	defer a.mu.Unlock()

	owned := state.LoadOwned(a.stateFile)
	statuses := []protocol.InterfaceStatus{}

	var errs []string

	egress := wg.DefaultEgress()
	want := map[string]bool{}
	for _, iface := range desired.Interfaces {
		want[iface.Name] = true
	}

	_ = os.MkdirAll(a.configDir, 0o700)

	// Интерфейсы, которых больше нет в желаемом состоянии, — вниз и удалить.
	for name := range owned.Fingerprints {
		if want[name] {
			continue
		}

		logx.Info("Интерфейс %s удалён из конфигурации — останавливаю", name)
		shell.Run(fmt.Sprintf("wg-quick down %s 2>/dev/null || true", a.confPath(name)), wgQuickTimeout)
		_ = os.Remove(a.confPath(name))
		delete(owned.Fingerprints, name)
	}

	for _, iface := range desired.Interfaces {
		status, err := a.applyInterface(&owned, iface, egress)
		if err != nil {
			message := err.Error()
			errs = append(errs, iface.Name+": "+message)
			statuses = append(statuses, protocol.InterfaceStatus{Name: iface.Name, Status: "error", Message: &message})
			logx.Error("Интерфейс %s: %s", iface.Name, message)

			continue
		}

		statuses = append(statuses, status)
	}

	tunnels, forwards := withoutConflicts(desired, &errs)
	var routes []protocol.ForwardStatus

	if len(tunnels) > 0 || len(owned.Tunnels) > 0 {
		if err := netcfg.ApplyTunnels(tunnels, owned.Tunnels); err != nil {
			errs = append(errs, err.Error())
		} else {
			owned.Tunnels = make([]string, 0, len(tunnels))
			for _, tunnel := range tunnels {
				owned.Tunnels = append(owned.Tunnels, tunnel.Name)
			}
		}
	}

	resolved := failover.Resolve(failover.ResolveHosts(forwards, a.lookup), health)

	for _, forward := range resolved {
		if forward.ID == "" {
			continue
		}

		status := protocol.ForwardStatus{ID: forward.ID, ActiveRoute: forward.ActiveRoute}
		if forward.ActiveCandidate != nil {
			status.ActiveCandidate = forward.ActiveCandidate
			status.ActiveNodeID = forward.Candidates[*forward.ActiveCandidate].NodeID
		}
		routes = append(routes, status)
	}

	if netcfg.HasIptables() {
		plain := make([]protocol.Forward, len(resolved))
		for i, forward := range resolved {
			plain[i] = forward.Forward
		}

		if err := netcfg.ApplyForwards(plain); err != nil {
			errs = append(errs, err.Error())
		} else {
			for _, args := range failover.StaleFlowArgs(a.applied, resolved) {
				result := shell.Exec(30*time.Second, "conntrack", args...)
				logx.Info("Цель %s/%s сменилась — сброшены её потоки (код %d)", args[2], args[4], result.Code)
			}
			a.applied = resolved
		}
	} else if len(forwards) > 0 {
		errs = append(errs, "iptables недоступен — пробросы не применены")
	}

	if a.socks != nil {
		errs = append(errs, a.socks.Apply(desired.Socks)...)
	}

	if err := state.SaveOwned(a.stateFile, owned); err != nil {
		errs = append(errs, "состояние агента: "+err.Error())
	}

	result := Result{Interfaces: statuses, Routes: routes}
	if len(errs) > 0 {
		joined := strings.Join(errs, "; ")
		result.ApplyError = &joined
	}

	return result
}

// withoutConflicts — туннели и пробросы без конфликтов с чужим на хосте:
// лучше не поднять релей, чем перехватить чужой трафик.
func withoutConflicts(desired protocol.DesiredState, errs *[]string) ([]protocol.Tunnel, []protocol.Forward) {
	host := netcfg.ReadHostNetwork()
	ports := netcfg.HostPorts{UDP: sysinfo.UDPPorts(), TCP: sysinfo.TCPPorts()}
	refused := map[string]bool{}

	tunnels := []protocol.Tunnel{}
	for _, tunnel := range desired.Tunnels {
		if conflict := netcfg.TunnelConflict(tunnel, host); conflict != "" {
			*errs = append(*errs, conflict)
			logx.Error("%s", conflict)
			refused[tunnel.RemoteTunnelIP] = true

			continue
		}
		tunnels = append(tunnels, tunnel)
	}

	forwards := []protocol.Forward{}
	for _, forward := range desired.Forwards {
		conflict := netcfg.ForwardConflict(forward, ports)
		if refused[forward.TargetIP] {
			conflict = fmt.Sprintf("%s/%d: туннель до %s не поднят — проброс не установлен", forward.Proto, forward.ListenPort, forward.TargetIP)
		}
		if conflict != "" {
			*errs = append(*errs, conflict)
			logx.Error("%s", conflict)

			continue
		}
		forwards = append(forwards, forward)
	}

	return tunnels, forwards
}

func (a *Applier) applyInterface(owned *state.Owned, iface protocol.Interface, egress string) (protocol.InterfaceStatus, error) {
	file := a.confPath(iface.Name)
	rendered := []byte(wg.RenderConfig(iface, egress))
	existing, _ := os.ReadFile(file)
	changed := !bytes.Equal(existing, rendered)

	if changed {
		tmp := file + ".tmp"
		if err := os.WriteFile(tmp, rendered, 0o600); err != nil {
			return protocol.InterfaceStatus{}, err
		}
		if err := os.Rename(tmp, file); err != nil {
			return protocol.InterfaceStatus{}, err
		}
	}

	up := wg.IsUp(iface.Name)
	fingerprint := wg.Fingerprint(iface, egress)
	fingerprintChanged := owned.Fingerprints[iface.Name] != fingerprint

	if !iface.Enabled {
		if up {
			logx.Info("Интерфейс %s выключен — опускаю", iface.Name)
			shell.Run("wg-quick down "+file, wgQuickTimeout)
		}
		owned.Fingerprints[iface.Name] = fingerprint

		return protocol.InterfaceStatus{Name: iface.Name, Status: "down"}, nil
	}

	switch {
	case !up:
		logx.Info("Поднимаю интерфейс %s", iface.Name)
		if err := shell.MustRun("wg-quick up "+file, wgQuickTimeout); err != nil {
			return protocol.InterfaceStatus{}, err
		}
	case fingerprintChanged:
		logx.Info("Interface-секция %s изменилась — перезапуск", iface.Name)
		shell.Run("wg-quick down "+file+" || true", wgQuickTimeout)
		if err := shell.MustRun("wg-quick up "+file, wgQuickTimeout); err != nil {
			return protocol.InterfaceStatus{}, err
		}
	case changed:
		logx.Info("Пиры %s изменились — wg syncconf", iface.Name)

		stripped := file + ".sync"
		if err := os.WriteFile(stripped, []byte(wg.RenderStripped(iface)), 0o600); err != nil {
			return protocol.InterfaceStatus{}, err
		}
		err := shell.MustRun(fmt.Sprintf("wg syncconf %s %s", iface.Name, stripped), wgQuickTimeout)
		_ = os.Remove(stripped)
		if err != nil {
			return protocol.InterfaceStatus{}, err
		}
	}

	owned.Fingerprints[iface.Name] = fingerprint

	return protocol.InterfaceStatus{Name: iface.Name, Status: "up"}, nil
}
