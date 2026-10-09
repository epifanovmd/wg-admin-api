package failover

import (
	"reflect"
	"testing"

	"wgadmin/agent/internal/desired"
)

func str(value string) *string { return &value }

func forward(patch func(*desired.Forward)) desired.Forward {
	f := desired.Forward{
		ID: "f1", Proto: "udp", ListenPort: 51820, TargetIP: "10.99.0.2", TargetPort: 51820,
		FallbackIP: str("203.0.113.20"), Route: "auto", Tunnel: str("wgt0"),
	}
	if patch != nil {
		patch(&f)
	}

	return f
}

func target(forwards []desired.Forward, health *Health) string {
	return Resolve(forwards, health)[0].TargetIP
}

func fail(health *Health, key string, times int) {
	for i := 0; i < times; i++ {
		health.Record(key, false)
	}
}

func TestAutoFailoverAndBack(t *testing.T) {
	health := NewHealth()
	f := []desired.Forward{forward(nil)}

	if target(f, health) != "10.99.0.2" {
		t.Fatal("туннель жив")
	}
	// Единичные потери не должны дёргать маршрут.
	fail(health, "wgt0", FailoverAfterFailures-1)
	if target(f, health) != "10.99.0.2" {
		t.Fatal("мало неудач")
	}
	fail(health, "wgt0", 1)
	if target(f, health) != "203.0.113.20" {
		t.Fatal("напрямую")
	}
	if Resolve(f, health)[0].ActiveRoute != "direct" {
		t.Fatal("активный маршрут")
	}
	health.Record("wgt0", true)
	if target(f, health) != "10.99.0.2" {
		t.Fatal("вернулся в туннель")
	}
}

func TestManualRoute(t *testing.T) {
	health := NewHealth()
	fail(health, "wgt0", 10)

	if target([]desired.Forward{forward(func(f *desired.Forward) { f.Route = "tunnel" })}, health) != "10.99.0.2" {
		t.Fatal("tunnel — всегда туннель")
	}
	if target([]desired.Forward{forward(func(f *desired.Forward) { f.Route = "direct" })}, NewHealth()) != "203.0.113.20" {
		t.Fatal("direct — всегда напрямую")
	}
}

func TestWithoutFallback(t *testing.T) {
	health := NewHealth()
	fail(health, "wgt0", 10)

	if target([]desired.Forward{forward(func(f *desired.Forward) { f.FallbackIP = nil })}, health) != "10.99.0.2" {
		t.Fatal("без прямого адреса — туннель")
	}

	plain := forward(func(f *desired.Forward) { f.Tunnel = nil; f.TargetIP = "203.0.113.5"; f.FallbackIP = nil })
	if target([]desired.Forward{plain}, health) != "203.0.113.5" {
		t.Fatal("без туннеля — как задан")
	}
}

func TestResolveHosts(t *testing.T) {
	lookup := func(host string) string {
		if host == "vpn.example.com" {
			return "198.51.100.7"
		}
		return ""
	}

	resolved := ResolveHosts([]desired.Forward{forward(func(f *desired.Forward) { f.FallbackIP = str("vpn.example.com") })}, lookup)[0]
	if resolved.TargetIP != "10.99.0.2" || *resolved.FallbackIP != "198.51.100.7" {
		t.Fatalf("%+v", resolved)
	}

	// Не разрешился — прямой путь недоступен, туннель остаётся.
	unresolved := ResolveHosts([]desired.Forward{forward(func(f *desired.Forward) { f.FallbackIP = str("unknown.example") })}, lookup)[0]
	if unresolved.FallbackIP != nil {
		t.Fatal("аварийный путь должен отключиться")
	}
}

func TestCandidates(t *testing.T) {
	health := NewHealth()
	replicated := []desired.Forward{forward(func(f *desired.Forward) {
		f.FallbackIP = nil
		f.Candidates = []desired.Candidate{
			{TargetIP: "10.99.0.2", Tunnel: str("wgt0")},
			{TargetIP: "10.99.0.6", Tunnel: str("wgt1")},
			{TargetIP: "203.0.113.9"},
		}
	})}
	pick := func() Resolved { return Resolve(replicated, health)[0] }

	if pick().TargetIP != "10.99.0.2" || *pick().ActiveCandidate != 0 {
		t.Fatal("первый")
	}
	fail(health, "wgt0", FailoverAfterFailures)
	if pick().TargetIP != "10.99.0.6" || *pick().ActiveCandidate != 1 {
		t.Fatal("следующий")
	}
	fail(health, "wgt1", FailoverAfterFailures)
	// Прямой кандидат без туннеля — по пробе его адреса.
	if pick().TargetIP != "203.0.113.9" || pick().ActiveRoute != "direct" {
		t.Fatal("прямой")
	}
	fail(health, "ip:203.0.113.9", FailoverAfterFailures)
	if pick().TargetIP != "10.99.0.2" {
		t.Fatal("все лежат — первый")
	}
	health.Record("wgt0", true)
	if *pick().ActiveCandidate != 0 {
		t.Fatal("ожил первый")
	}
}

// Точка IPIP с маршрутом auto: у каждой копии туннель, затем её прямой
// адрес. Лёг только туннель — трафик остаётся на той же ноде напрямую;
// нода недоступна целиком — следующая копия.
func TestTunnelThenDirectPerCopy(t *testing.T) {
	health := NewHealth()
	endpoint := []desired.Forward{forward(func(f *desired.Forward) {
		f.FallbackIP = nil
		f.Candidates = []desired.Candidate{
			{TargetIP: "10.99.0.2", Tunnel: str("wgt0"), NodeID: "a"},
			{TargetIP: "203.0.113.20", NodeID: "a"},
			{TargetIP: "10.99.0.6", Tunnel: str("wgt1"), NodeID: "c"},
			{TargetIP: "203.0.113.30", NodeID: "c"},
		}
	})}
	pick := func() Resolved { return Resolve(endpoint, health)[0] }

	fail(health, "wgt0", FailoverAfterFailures)
	if pick().TargetIP != "203.0.113.20" || pick().ActiveRoute != "direct" {
		t.Fatal("туннель лёг — прямой адрес той же ноды")
	}
	fail(health, "ip:203.0.113.20", FailoverAfterFailures)
	if pick().TargetIP != "10.99.0.6" || pick().ActiveRoute != "tunnel" {
		t.Fatal("нода недоступна целиком — копия через туннель")
	}
}

func TestPinnedCandidate(t *testing.T) {
	health := NewHealth()
	fail(health, "wgt1", 10)

	pinned := []desired.Forward{forward(func(f *desired.Forward) {
		f.FallbackIP = nil
		f.Candidates = []desired.Candidate{{TargetIP: "10.99.0.6", Tunnel: str("wgt1")}}
	})}
	if target(pinned, health) != "10.99.0.6" {
		t.Fatal("закреплённая — всегда она")
	}
}

func TestDomainCandidateHealthKey(t *testing.T) {
	// Проба пингует исходный адрес (домен), выбор — по разрешённому IP:
	// ключ здоровья должен совпадать, иначе мёртвая реплика не отбросится.
	health := NewHealth()
	original := []desired.Forward{forward(func(f *desired.Forward) {
		f.FallbackIP = nil
		f.Candidates = []desired.Candidate{{TargetIP: "node-a.example.com"}, {TargetIP: "203.0.113.20"}}
	})}

	probes := DirectCandidateIPs(original)
	if !reflect.DeepEqual(probes, []string{"node-a.example.com", "203.0.113.20"}) {
		t.Fatalf("%v", probes)
	}
	fail(health, "ip:node-a.example.com", FailoverAfterFailures)

	resolved := ResolveHosts(original, func(host string) string {
		if host == "node-a.example.com" {
			return "198.51.100.1"
		}
		return ""
	})
	if target(resolved, health) != "203.0.113.20" {
		t.Fatal("мёртвая реплика с доменом должна отбрасываться")
	}
}

func TestStaleFlowArgs(t *testing.T) {
	wrap := func(forwards ...desired.Forward) []Resolved {
		var out []Resolved
		for _, f := range forwards {
			out = append(out, Resolved{Forward: f})
		}
		return out
	}
	udp := desired.Forward{Proto: "udp", ListenPort: 51820, TargetIP: "172.21.0.5", TargetPort: 51820}
	tcp := desired.Forward{Proto: "tcp", ListenPort: 8443, TargetIP: "10.99.0.2", TargetPort: 8443}
	moved := udp
	moved.TargetIP = "172.21.0.9"

	got := StaleFlowArgs(wrap(udp, tcp), wrap(moved, tcp))
	if !reflect.DeepEqual(got, [][]string{{"-D", "-p", "udp", "--dport", "51820"}}) {
		t.Fatalf("%v", got)
	}
	if len(StaleFlowArgs(wrap(moved, tcp), wrap(moved, tcp))) != 0 || len(StaleFlowArgs(nil, wrap(moved))) != 0 {
		t.Fatal("без смены цели — без сброса")
	}
}
