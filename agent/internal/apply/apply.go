// Package apply — приведение узла к желаемому состоянию: конфиги wg-quick,
// интерфейсы, IPIP-туннели и пробросы. Вызовы не должны пересекаться:
// очередь применений держит вызывающий.
package apply

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/netcfg"
	"wgadmin/agent/internal/shell"
	"wgadmin/agent/internal/state"
	"wgadmin/agent/internal/sysinfo"
	"wgadmin/agent/internal/wg"
)

// WgQuickTimeout — срок одной команды wg-quick: итог применения должен
// успеть к сроку агента (30 с на PUT /config).
const WgQuickTimeout = 20 * time.Second

// Result — итог применения: ошибки отдельных частей не прерывают остальные.
type Result struct {
	Interfaces []desired.InterfaceStatus
	Routes     []desired.ForwardStatus
	Errors     []string
}

// Applier — применение на узле; помнит последние цели пробросов (сброс
// потоков conntrack при их смене).
type Applier struct {
	configDir string
	stateFile string
	applied   []failover.Resolved
	lookup    func(string) string
}

// New — применение с конфигами wg-quick в configDir и состоянием в stateFile.
func New(configDir, stateFile string) *Applier {
	return &Applier{configDir: configDir, stateFile: stateFile, lookup: failover.LookupIPv4}
}

// ConfPath — файл конфига интерфейса.
func ConfPath(configDir, name string) string {
	return filepath.Join(configDir, name+".conf")
}

func (a *Applier) confPath(name string) string { return ConfPath(a.configDir, name) }

// Routes — активные маршруты пробросов с id.
func Routes(resolved []failover.Resolved) []desired.ForwardStatus {
	routes := []desired.ForwardStatus{}

	for _, forward := range resolved {
		if forward.ID == "" {
			continue
		}

		status := desired.ForwardStatus{ID: forward.ID, ActiveRoute: forward.ActiveRoute}
		if forward.ActiveCandidate != nil {
			status.ActiveCandidate = forward.ActiveCandidate
			status.ActiveNodeID = forward.Candidates[*forward.ActiveCandidate].NodeID
		}
		routes = append(routes, status)
	}

	return routes
}

// Apply — конфиги интерфейсов (атомарно, 0600), wg-quick up/down, `wg
// syncconf` для пиров, туннели и пробросы.
func (a *Applier) Apply(target desired.State, health *failover.Health) Result {
	owned := state.LoadOwned(a.stateFile)
	result := Result{Interfaces: []desired.InterfaceStatus{}, Routes: []desired.ForwardStatus{}, Errors: []string{}}

	egress := wg.DefaultEgress()
	want := map[string]bool{}
	for _, iface := range target.Interfaces {
		want[iface.Name] = true
	}

	if err := os.MkdirAll(a.configDir, 0o700); err != nil {
		result.Errors = append(result.Errors, "каталог конфигов: "+err.Error())
	}

	// Интерфейсы воркера, которых больше нет в желаемом состоянии, — вниз и удалить.
	for name := range owned.Fingerprints {
		if want[name] {
			continue
		}

		logx.Info("Интерфейс %s удалён из конфигурации — останавливаю", name)
		shell.Run(fmt.Sprintf("wg-quick down %s 2>/dev/null || true", a.confPath(name)), WgQuickTimeout)
		_ = os.Remove(a.confPath(name))
		delete(owned.Fingerprints, name)
	}

	for _, iface := range target.Interfaces {
		status, err := a.applyInterface(&owned, iface, egress)
		if err != nil {
			message := err.Error()
			result.Errors = append(result.Errors, iface.Name+": "+message)
			result.Interfaces = append(result.Interfaces, desired.InterfaceStatus{Name: iface.Name, Status: "error", Message: message})
			logx.Error("Интерфейс %s: %s", iface.Name, message)

			continue
		}

		result.Interfaces = append(result.Interfaces, status)
	}

	tunnels, forwards := withoutConflicts(target, &result.Errors)

	if len(tunnels) > 0 || len(owned.Tunnels) > 0 {
		if err := netcfg.ApplyTunnels(tunnels, owned.Tunnels); err != nil {
			result.Errors = append(result.Errors, err.Error())
		} else {
			owned.Tunnels = make([]string, 0, len(tunnels))
			for _, tunnel := range tunnels {
				owned.Tunnels = append(owned.Tunnels, tunnel.Name)
			}
		}
	}

	resolved := failover.Resolve(failover.ResolveHosts(forwards, a.lookup), health)
	result.Routes = Routes(resolved)

	if netcfg.HasIptables() {
		plain := make([]desired.Forward, len(resolved))
		for i, forward := range resolved {
			plain[i] = forward.Forward
		}

		if err := netcfg.ApplyForwards(plain); err != nil {
			result.Errors = append(result.Errors, err.Error())
		} else {
			for _, args := range failover.StaleFlowArgs(a.applied, resolved) {
				code := shell.Exec(10*time.Second, "conntrack", args...).Code
				logx.Info("Цель %s/%s сменилась — сброшены её потоки (код %d)", args[2], args[4], code)
			}
			a.applied = resolved
		}
	} else if len(forwards) > 0 {
		result.Errors = append(result.Errors, "iptables недоступен — пробросы не применены")
	}

	if err := state.SaveOwned(a.stateFile, owned); err != nil {
		result.Errors = append(result.Errors, "состояние воркера: "+err.Error())
	}

	return result
}

// withoutConflicts — туннели и пробросы без конфликтов с чужим на узле:
// лучше не поднять релей, чем перехватить чужой трафик.
func withoutConflicts(wanted desired.State, errs *[]string) ([]desired.Tunnel, []desired.Forward) {
	host := netcfg.ReadHostNetwork()
	ports := netcfg.HostPorts{UDP: sysinfo.UDPPorts(), TCP: sysinfo.TCPPorts()}
	refused := map[string]bool{}

	tunnels := []desired.Tunnel{}
	for _, tunnel := range wanted.Tunnels {
		if conflict := netcfg.TunnelConflict(tunnel, host); conflict != "" {
			*errs = append(*errs, conflict)
			logx.Error("%s", conflict)
			refused[tunnel.RemoteTunnelIP] = true

			continue
		}
		tunnels = append(tunnels, tunnel)
	}

	forwards := []desired.Forward{}
	for _, forward := range wanted.Forwards {
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

// ForeignConfig — причина не трогать интерфейс, которого воркер не создавал:
// в каталоге уже лежит другой конфиг с этим именем или интерфейс поднят без
// конфига. Совпадающий конфиг воркер принимает как свой.
func ForeignConfig(name string, existing []byte, exists bool, rendered []byte, up bool) error {
	switch {
	case exists && !bytes.Equal(existing, rendered):
		return fmt.Errorf("чужой конфиг: %s.conf уже есть и создан не воркером — не перезаписываю", name)
	case !exists && up:
		return fmt.Errorf("интерфейс %s уже есть на узле и создан не воркером", name)
	}

	return nil
}

func writeAtomic(file string, data []byte) error {
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}

	return os.Rename(tmp, file)
}

func (a *Applier) applyInterface(owned *state.Owned, iface desired.Interface, egress string) (desired.InterfaceStatus, error) {
	file := a.confPath(iface.Name)
	rendered := []byte(wg.RenderConfig(iface, egress))
	existing, readErr := os.ReadFile(file)
	exists := readErr == nil
	up := wg.IsUp(iface.Name)

	if _, ours := owned.Fingerprints[iface.Name]; !ours {
		if err := ForeignConfig(iface.Name, existing, exists, rendered, up); err != nil {
			return desired.InterfaceStatus{}, err
		}
		// Отметка «свой» — до записи файла: иначе прерванное применение
		// оставило бы конфиг, который следующее сочтёт чужим.
		owned.Fingerprints[iface.Name] = ""
		if err := state.SaveOwned(a.stateFile, *owned); err != nil {
			return desired.InterfaceStatus{}, err
		}
	}

	changed := !bytes.Equal(existing, rendered)
	if changed {
		if err := writeAtomic(file, rendered); err != nil {
			return desired.InterfaceStatus{}, err
		}
	}

	fingerprint := wg.Fingerprint(iface, egress)
	fingerprintChanged := owned.Fingerprints[iface.Name] != fingerprint

	if !iface.Enabled {
		if up {
			logx.Info("Интерфейс %s выключен — опускаю", iface.Name)
			shell.Run("wg-quick down "+file, WgQuickTimeout)
		}
		owned.Fingerprints[iface.Name] = fingerprint

		return desired.InterfaceStatus{Name: iface.Name, Status: "down"}, nil
	}

	switch {
	case !up:
		logx.Info("Поднимаю интерфейс %s", iface.Name)
		if err := shell.MustRun("wg-quick up "+file, WgQuickTimeout); err != nil {
			return desired.InterfaceStatus{}, err
		}
	case fingerprintChanged:
		logx.Info("Interface-секция %s изменилась — перезапуск", iface.Name)
		shell.Run("wg-quick down "+file+" || true", WgQuickTimeout)
		if err := shell.MustRun("wg-quick up "+file, WgQuickTimeout); err != nil {
			return desired.InterfaceStatus{}, err
		}
	case changed:
		logx.Info("Пиры %s изменились — wg syncconf", iface.Name)

		stripped := file + ".sync"
		if err := os.WriteFile(stripped, []byte(wg.RenderStripped(iface)), 0o600); err != nil {
			return desired.InterfaceStatus{}, err
		}
		err := shell.MustRun(fmt.Sprintf("wg syncconf %s %s", iface.Name, stripped), WgQuickTimeout)
		_ = os.Remove(stripped)
		if err != nil {
			return desired.InterfaceStatus{}, err
		}
	}

	owned.Fingerprints[iface.Name] = fingerprint

	return desired.InterfaceStatus{Name: iface.Name, Status: "up"}, nil
}

// Restart — wg-quick down и up интерфейса воркера.
func (a *Applier) Restart(name string) error {
	if _, ours := state.LoadOwned(a.stateFile).Fingerprints[name]; !ours {
		return errors.New("интерфейс " + name + " не создан воркером")
	}

	file := a.confPath(name)
	logx.Info("Перезапуск интерфейса %s", name)
	shell.Run("wg-quick down "+file+" 2>/dev/null || true", WgQuickTimeout)

	return shell.MustRun("wg-quick up "+file, WgQuickTimeout)
}
