// Package probe — проверки связности через ping: IPIP-туннели (и MTU),
// другие ноды, адреса реплик.
package probe

import (
	"math"
	"regexp"
	"strconv"
	"sync"
	"time"

	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/shell"
)

const pingTimeout = 8 * time.Second

var (
	lossPattern = regexp.MustCompile(`([\d.]+)% packet loss`)
	rttPattern  = regexp.MustCompile(`= [\d.]+/([\d.]+)/`)
)

// Ping — средний RTT (nil — нет ответов) и потери, %.
type Ping struct {
	RttMs       *float64
	LossPercent float64
}

func round1(value float64) float64 { return math.Round(value*10) / 10 }

// ParsePing разбирает итог `ping -q`; nil — вывода статистики нет (нет ping).
func ParsePing(output string) *Ping {
	loss := lossPattern.FindStringSubmatch(output)
	if loss == nil {
		return nil
	}

	lossValue, _ := strconv.ParseFloat(loss[1], 64)
	result := &Ping{LossPercent: round1(lossValue)}

	if rtt := rttPattern.FindStringSubmatch(output); rtt != nil {
		value, _ := strconv.ParseFloat(rtt[1], 64)
		value = round1(value)
		result.RttMs = &value
	}

	return result
}

func ping(args ...string) *Ping {
	base := []string{"-n", "-q", "-c", "3", "-i", "0.2", "-W", "1"}
	result := shell.Exec(pingTimeout, "ping", append(base, args...)...)

	return ParsePing(result.Stdout + "\n" + result.Stderr)
}

// Tunnels — 3 пакета до дальнего конца через сам туннель; живой — ещё и
// пакет полного размера с запретом фрагментации (MTU − 28 байт IP/ICMP).
func Tunnels(tunnels []protocol.Tunnel) []protocol.TunnelProbe {
	results := make([]*protocol.TunnelProbe, len(tunnels))

	var wg sync.WaitGroup

	for i, tunnel := range tunnels {
		wg.Add(1)

		go func(i int, tunnel protocol.Tunnel) {
			defer wg.Done()

			parsed := ping("-I", tunnel.Name, tunnel.RemoteTunnelIP)
			if parsed == nil {
				return
			}

			probe := &protocol.TunnelProbe{Name: tunnel.Name, RttMs: parsed.RttMs, LossPercent: parsed.LossPercent}

			if parsed.LossPercent < 100 {
				mtu := ping("-M", "do", "-s", strconv.Itoa(tunnel.MTU-28), "-I", tunnel.Name, tunnel.RemoteTunnelIP)
				ok := mtu != nil && mtu.LossPercent < 100
				probe.MtuOk = &ok
			}

			results[i] = probe
		}(i, tunnel)
	}
	wg.Wait()

	out := []protocol.TunnelProbe{}
	for _, probe := range results {
		if probe != nil {
			out = append(out, *probe)
		}
	}

	return out
}

// Nodes — 3 пакета до publicHost; закрытый ICMP — 100% потерь, тоже результат.
func Nodes(targets []protocol.ProbeTarget) []protocol.NodeProbe {
	results := make([]*protocol.NodeProbe, len(targets))

	var wg sync.WaitGroup

	for i, target := range targets {
		wg.Add(1)

		go func(i int, target protocol.ProbeTarget) {
			defer wg.Done()

			if parsed := ping(target.Host); parsed != nil {
				results[i] = &protocol.NodeProbe{NodeID: target.NodeID, RttMs: parsed.RttMs, LossPercent: parsed.LossPercent}
			}
		}(i, target)
	}
	wg.Wait()

	out := []protocol.NodeProbe{}
	for _, probe := range results {
		if probe != nil {
			out = append(out, *probe)
		}
	}

	return out
}

// IPs — доступность адресов (реплики без туннеля): адрес → ответил ли.
func IPs(ips []string) map[string]bool {
	targets := make([]protocol.ProbeTarget, len(ips))
	for i, ip := range ips {
		targets[i] = protocol.ProbeTarget{NodeID: ip, Host: ip}
	}

	result := map[string]bool{}
	for _, probe := range Nodes(targets) {
		result[probe.NodeID] = probe.LossPercent < 100
	}

	return result
}
