package main

import (
	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/contract"
	"wgadmin/agent/internal/failover"
)

// HostInfo — сведения об узле (событие node.info).
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
// (WG_DRY_RUN=1). Логика связи с агентом, повторов и проб — общая. Вызовы Apply и Restart не
// пересекаются: их очередь держит Service. Cleanup — в отдельном запуске (wg cleanup), когда
// воркер остановлен.
type System interface {
	// Ready — ошибка, если воркер на этом узле работать не может (нет wg).
	Ready() error
	Info() HostInfo
	Apply(state contract.State, health *failover.Health) apply.Result
	Restart(name string) error
	// Cleanup — убрать всё созданное воркером и его файл состояния.
	Cleanup()
	// Dump — счётчики пиров интерфейсов names (только поднятые).
	Dump(names []string) []contract.InterfaceStats
	ProbeTunnels(tunnels []contract.Tunnel) []contract.TunnelProbe
	ProbeIPs(ips []string) map[string]bool
	ProbeNodes(targets []contract.ProbeTarget) []contract.NodeProbe
}
