package main

import (
	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/failover"
)

// HostInfo — сведения об узле для GET /health.
type HostInfo struct {
	WgVersion string
	// WgMode — kernel | userspace; "" — неизвестно (нет wg).
	WgMode   string
	Distro   string
	Kernel   string
	UDPPorts []int
	TCPPorts []int
}

// System — работа с узлом: настоящая (wg-quick, ip, iptables) или имитация
// (WG_DRY_RUN=1). Логика HTTP, повторов и проб — общая. Вызовы Apply, Restart
// и Cleanup не пересекаются: их очередь держит Service.
type System interface {
	// Ready — ошибка, если воркер на этом узле работать не может (нет wg).
	Ready() error
	Info() HostInfo
	Apply(state desired.State, health *failover.Health) apply.Result
	Restart(name string) error
	// Cleanup — убрать всё созданное воркером и его файл состояния.
	Cleanup()
	// Dump — счётчики пиров интерфейсов names (только поднятые).
	Dump(names []string) []desired.InterfaceStats
	ProbeTunnels(tunnels []desired.Tunnel) []desired.TunnelProbe
	ProbeIPs(ips []string) map[string]bool
	ProbeNodes(targets []desired.ProbeTarget) []desired.NodeProbe
}
