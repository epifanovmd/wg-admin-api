package main

import (
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"

	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/cleanup"
	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/probe"
	"wgadmin/agent/internal/sysinfo"
	"wgadmin/agent/internal/wg"
)

// realSystem — узел Linux: wireguard-tools, iproute2, iptables, conntrack, ping.
type realSystem struct {
	configDir string
	stateFile string
	applier   *apply.Applier
}

func newRealSystem(configDir, stateDir string) *realSystem {
	stateFile := filepath.Join(stateDir, "state.json")

	return &realSystem{configDir: configDir, stateFile: stateFile, applier: apply.New(configDir, stateFile)}
}

func (s *realSystem) Ready() error {
	if runtime.GOOS != "linux" {
		return errors.New("воркер wg настраивает узел только на Linux; для проверки на этой машине — WG_DRY_RUN=1")
	}
	for _, tool := range []string{"wg", "wg-quick", "ip"} {
		if _, err := exec.LookPath(tool); err != nil {
			return errors.New("нет " + tool + " — поставьте wireguard-tools и iproute2")
		}
	}

	return nil
}

func (s *realSystem) Info() HostInfo {
	info := HostInfo{
		WgVersion: wg.Version(),
		Distro:    sysinfo.Distro(),
		Kernel:    sysinfo.Kernel(),
		UDPPorts:  sysinfo.UDPPorts(),
		TCPPorts:  sysinfo.TCPPorts(),
	}
	if info.WgVersion != "" {
		info.WgMode = sysinfo.WgMode()
	}

	return info
}

func (s *realSystem) Apply(state desired.State, health *failover.Health) apply.Result {
	return s.applier.Apply(state, health)
}

func (s *realSystem) Restart(name string) error { return s.applier.Restart(name) }

func (s *realSystem) Cleanup() {
	cleanup.Owned(s.configDir, s.stateFile)
	s.applier = apply.New(s.configDir, s.stateFile)
}

func (s *realSystem) Dump(names []string) []desired.InterfaceStats {
	dump, err := wg.ReadDump()
	if err != nil {
		return []desired.InterfaceStats{}
	}

	return pickInterfaces(dump, names)
}

// pickInterfaces — интерфейсы names из дампа, в порядке names.
func pickInterfaces(dump wg.Dump, names []string) []desired.InterfaceStats {
	result := []desired.InterfaceStats{}

	for _, name := range names {
		if peers, ok := dump[name]; ok {
			result = append(result, desired.InterfaceStats{Name: name, Peers: peers})
		}
	}

	return result
}

func (s *realSystem) ProbeTunnels(tunnels []desired.Tunnel) []desired.TunnelProbe {
	return probe.Tunnels(tunnels)
}

func (s *realSystem) ProbeIPs(ips []string) map[string]bool { return probe.IPs(ips) }

func (s *realSystem) ProbeNodes(targets []desired.ProbeTarget) []desired.NodeProbe {
	return probe.Nodes(targets)
}
