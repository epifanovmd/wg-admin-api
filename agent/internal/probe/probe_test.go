package probe

import "testing"

func TestParsePing(t *testing.T) {
	out := `PING 10.99.0.2 (10.99.0.2) from 10.99.0.1 wgt0: 56(84) bytes of data.

--- 10.99.0.2 ping statistics ---
3 packets transmitted, 2 received, 33.3333% packet loss, time 402ms
rtt min/avg/max/mdev = 41.120/42.515/43.910/1.395 ms
`
	parsed := ParsePing(out)
	if parsed == nil || *parsed.RttMs != 42.5 || parsed.LossPercent != 33.3 {
		t.Fatalf("%+v", parsed)
	}

	down := ParsePing("--- 10.99.0.2 ping statistics ---\n3 packets transmitted, 0 received, 100% packet loss, time 2041ms\n")
	if down == nil || down.RttMs != nil || down.LossPercent != 100 {
		t.Fatalf("туннель лежит: %+v", down)
	}

	if ParsePing("sh: ping: not found") != nil {
		t.Fatal("нет статистики — nil")
	}
}

func TestPingArgs(t *testing.T) {
	// Связность нод — 10 пакетов: одна потеря в пробе — 10%, а не 33%.
	nodes := pingArgs(nodePackets, "198.51.100.10")
	if nodes[3] != "10" || nodes[len(nodes)-1] != "198.51.100.10" {
		t.Fatalf("nodes: %v", nodes)
	}

	// Туннели и реплики — по-прежнему 3: проба каждые 10 с.
	tunnel := pingArgs(quickPackets, "-I", "wgt1", "10.255.0.2")
	if tunnel[3] != "3" || tunnel[len(tunnel)-3] != "-I" {
		t.Fatalf("tunnel: %v", tunnel)
	}
}
