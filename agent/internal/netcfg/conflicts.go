// Package netcfg — IPIP-туннели и пробросы портов через iptables, проверки
// против чужого на хосте.
package netcfg

import (
	"fmt"
	"net"
	"regexp"
	"strings"

	"wgadmin/agent/internal/desired"
)

// HostAddr — IPv4-адрес интерфейса хоста.
type HostAddr struct {
	Dev  string
	Cidr string
}

// HostTunnel — IPIP-туннель хоста.
type HostTunnel struct {
	Dev    string
	Remote string
}

// HostNetwork — адреса и туннели хоста (для проверок против чужого).
type HostNetwork struct {
	Addrs   []HostAddr
	Tunnels []HostTunnel
}

// HostPorts — занятые порты хоста.
type HostPorts struct {
	UDP []int
	TCP []int
}

var (
	addrLine   = regexp.MustCompile(`^\d+:\s+(\S+)\s+inet\s+(\S+)`)
	tunnelDev  = regexp.MustCompile(`^\d+:\s+([^:@\s]+)`)
	ipipRemote = regexp.MustCompile(`ipip remote (\S+)`)
)

// ParseIPv4Addrs разбирает `ip -o -4 addr show`.
func ParseIPv4Addrs(output string) []HostAddr {
	var addrs []HostAddr

	for _, line := range strings.Split(output, "\n") {
		if match := addrLine.FindStringSubmatch(line); match != nil {
			addrs = append(addrs, HostAddr{Dev: match[1], Cidr: match[2]})
		}
	}

	return addrs
}

// ParseIpipTunnels разбирает `ip -d -o link show type ipip`.
func ParseIpipTunnels(output string) []HostTunnel {
	var tunnels []HostTunnel

	for _, line := range strings.Split(output, "\n") {
		dev := tunnelDev.FindStringSubmatch(line)
		remote := ipipRemote.FindStringSubmatch(line)

		if dev != nil && remote != nil {
			tunnels = append(tunnels, HostTunnel{Dev: dev[1], Remote: remote[1]})
		}
	}

	return tunnels
}

func overlaps(a, b string) bool {
	_, na, errA := net.ParseCIDR(a)
	_, nb, errB := net.ParseCIDR(b)

	if errA != nil || errB != nil {
		return false
	}

	return na.Contains(nb.IP) || nb.Contains(na.IP)
}

// TunnelConflict — причина не поднимать туннель: его подсеть занята чужим
// интерфейсом или к тому же хосту уже есть чужой IPIP-туннель.
func TunnelConflict(tunnel desired.Tunnel, host HostNetwork) string {
	cidr := fmt.Sprintf("%s/%d", tunnel.LocalTunnelIP, tunnel.Prefix)

	for _, addr := range host.Addrs {
		if addr.Dev != tunnel.Name && overlaps(addr.Cidr, cidr) {
			return fmt.Sprintf("%s: подсеть %s пересекается с %s на %s — смените WG_RELAY_TUNNEL_CIDR", tunnel.Name, cidr, addr.Cidr, addr.Dev)
		}
	}
	for _, other := range host.Tunnels {
		if other.Dev != tunnel.Name && other.Remote == tunnel.RemoteHost {
			return fmt.Sprintf("%s: к %s уже есть чужой IPIP-туннель %s", tunnel.Name, tunnel.RemoteHost, other.Dev)
		}
	}

	return ""
}

// ForwardConflict — порт проброса уже слушает другой процесс.
func ForwardConflict(forward desired.Forward, ports HostPorts) string {
	busy := ports.UDP
	if forward.Proto == "tcp" {
		busy = ports.TCP
	}

	for _, port := range busy {
		if port == forward.ListenPort {
			return fmt.Sprintf("%s/%d уже слушает другой процесс на хосте — проброс не установлен", forward.Proto, forward.ListenPort)
		}
	}

	return ""
}
