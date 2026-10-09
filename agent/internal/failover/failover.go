// Package failover — выбор маршрута пробросов по здоровью туннелей и
// реплик: решение локальное, работает и без бэкенда.
package failover

import (
	"net"
	"regexp"
	"strconv"
	"sync"

	"wgadmin/agent/internal/desired"
)

// FailoverAfterFailures — неудачных проб подряд (~10 с каждая) до ухода.
const FailoverAfterFailures = 3

// Health — подряд идущие неудачные пробы туннелей и адресов (`ip:<адрес>`).
type Health struct {
	mu       sync.Mutex
	failures map[string]int
}

// NewHealth — все считаются живыми, пока нет проб.
func NewHealth() *Health {
	return &Health{failures: map[string]int{}}
}

// Record — результат пробы.
func (h *Health) Record(key string, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if ok {
		h.failures[key] = 0
	} else {
		h.failures[key]++
	}
}

// IsDown — неудач подряд не меньше порога.
func (h *Health) IsDown(key string) bool {
	if h == nil {
		return false
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	return h.failures[key] >= FailoverAfterFailures
}

// Resolved — проброс с выбранной целью.
type Resolved struct {
	desired.Forward
	ActiveRoute     string
	ActiveCandidate *int
}

func healthKey(candidate desired.Candidate) string {
	if candidate.Tunnel != nil && *candidate.Tunnel != "" {
		return *candidate.Tunnel
	}
	if candidate.ProbeHost != "" {
		return "ip:" + candidate.ProbeHost
	}

	return "ip:" + candidate.TargetIP
}

func hasTunnel(tunnel *string) bool { return tunnel != nil && *tunnel != "" }

// DirectCandidateIPs — адреса кандидатов без туннеля: их воркер пингует сам.
func DirectCandidateIPs(forwards []desired.Forward) []string {
	seen := map[string]bool{}

	var ips []string

	for _, forward := range forwards {
		for _, candidate := range forward.Candidates {
			if hasTunnel(candidate.Tunnel) {
				continue
			}

			ip := candidate.ProbeHost
			if ip == "" {
				ip = candidate.TargetIP
			}
			if !seen[ip] {
				seen[ip] = true
				ips = append(ips, ip)
			}
		}
	}

	return ips
}

// Resolve — цель каждого проброса: реплики — первая живая (одна —
// закреплённая); `auto` уходит напрямую только после нескольких неудач
// туннеля подряд и возвращается при первой удачной пробе.
func Resolve(forwards []desired.Forward, health *Health) []Resolved {
	result := make([]Resolved, 0, len(forwards))

	for _, forward := range forwards {
		if len(forward.Candidates) > 0 {
			index := 0

			for i, candidate := range forward.Candidates {
				if len(forward.Candidates) == 1 || !health.IsDown(healthKey(candidate)) {
					index = i

					break
				}
			}

			candidate := forward.Candidates[index]
			resolved := forward
			resolved.TargetIP = candidate.TargetIP
			resolved.Tunnel = candidate.Tunnel

			route := "direct"
			if hasTunnel(candidate.Tunnel) {
				route = "tunnel"
			}

			active := index
			result = append(result, Resolved{Forward: resolved, ActiveRoute: route, ActiveCandidate: &active})

			continue
		}

		canFallback := hasTunnel(forward.Tunnel) && forward.FallbackIP != nil && *forward.FallbackIP != ""
		direct := canFallback && (forward.Route == "direct" ||
			(forward.Route != "tunnel" && health.IsDown(*forward.Tunnel)))

		if direct {
			resolved := forward
			resolved.TargetIP = *forward.FallbackIP
			result = append(result, Resolved{Forward: resolved, ActiveRoute: "direct"})

			continue
		}

		route := "direct"
		if hasTunnel(forward.Tunnel) {
			route = "tunnel"
		}
		result = append(result, Resolved{Forward: forward, ActiveRoute: route})
	}

	return result
}

var ipv4 = regexp.MustCompile(`^\d{1,3}(\.\d{1,3}){3}$`)

// LookupIPv4 — первый IPv4-адрес имени; "" — не разрешилось.
func LookupIPv4(host string) string {
	addrs, err := net.LookupIP(host)
	if err != nil {
		return ""
	}

	for _, addr := range addrs {
		if v4 := addr.To4(); v4 != nil {
			return v4.String()
		}
	}

	return ""
}

// ResolveHosts — DNAT принимает только IP: доменные цели разрешаются в
// IPv4. Не разрешившийся прямой адрес отключает аварийный путь; основная
// цель остаётся как есть (iptables вернёт ошибку в отчёт).
func ResolveHosts(forwards []desired.Forward, lookup func(string) string) []desired.Forward {
	resolve := func(host string) string {
		if host == "" || ipv4.MatchString(host) {
			return host
		}

		return lookup(host)
	}

	result := make([]desired.Forward, 0, len(forwards))

	for _, forward := range forwards {
		resolved := forward

		if ip := resolve(forward.TargetIP); ip != "" {
			resolved.TargetIP = ip
		}
		if forward.FallbackIP != nil {
			if ip := resolve(*forward.FallbackIP); ip != "" {
				resolved.FallbackIP = &ip
			} else {
				resolved.FallbackIP = nil
			}
		}
		if forward.Candidates != nil {
			resolved.Candidates = make([]desired.Candidate, len(forward.Candidates))

			for i, candidate := range forward.Candidates {
				if candidate.ProbeHost == "" {
					candidate.ProbeHost = candidate.TargetIP
				}
				if ip := resolve(candidate.TargetIP); ip != "" {
					candidate.TargetIP = ip
				}
				resolved.Candidates[i] = candidate
			}
		}

		result = append(result, resolved)
	}

	return result
}

// StaleFlowArgs — аргументы `conntrack` для сброса потоков пробросов со
// сменившейся целью: DNAT применяется к первому пакету потока, дальше
// ядро держит запись, пока идут пакеты (keepalive WireGuard — постоянно).
func StaleFlowArgs(before []Resolved, after []Resolved) [][]string {
	key := func(forward desired.Forward) string {
		return forward.Proto + "/" + strconv.Itoa(forward.ListenPort)
	}

	previous := map[string]desired.Forward{}
	for _, forward := range before {
		previous[key(forward.Forward)] = forward.Forward
	}

	var args [][]string

	for _, forward := range after {
		old, ok := previous[key(forward.Forward)]
		if ok && (old.TargetIP != forward.TargetIP || old.TargetPort != forward.TargetPort) {
			args = append(args, []string{"-D", "-p", forward.Proto, "--dport", strconv.Itoa(forward.ListenPort)})
		}
	}

	return args
}
