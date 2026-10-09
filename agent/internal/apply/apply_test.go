package apply

import (
	"strings"
	"testing"

	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/failover"
)

func TestForeignConfig(t *testing.T) {
	rendered := []byte("[Interface]\nPrivateKey = A\n")

	if err := ForeignConfig("wg0", nil, false, rendered, false); err != nil {
		t.Fatalf("нет файла и интерфейса — свой: %v", err)
	}
	if err := ForeignConfig("wg0", rendered, true, rendered, true); err != nil {
		t.Fatalf("тот же конфиг — принимается как свой: %v", err)
	}
	if err := ForeignConfig("wg0", []byte("[Interface]\nPrivateKey = B\n"), true, rendered, false); err == nil || !strings.Contains(err.Error(), "чужой конфиг") {
		t.Fatalf("другой конфиг — чужой: %v", err)
	}
	if err := ForeignConfig("wg0", nil, false, rendered, true); err == nil {
		t.Fatal("интерфейс поднят без конфига — чужой")
	}
}

func TestRoutes(t *testing.T) {
	tunnel := "wgt1"
	forwards := []desired.Forward{
		{ID: "f1", Proto: "udp", ListenPort: 51820, TargetIP: "10.99.0.2", TargetPort: 51820, Candidates: []desired.Candidate{
			{TargetIP: "10.99.0.2", Tunnel: &tunnel, NodeID: "n1"},
			{TargetIP: "203.0.113.7", NodeID: "n2"},
		}},
		{Proto: "tcp", ListenPort: 8443, TargetIP: "203.0.113.8", TargetPort: 443},
	}

	routes := Routes(failover.Resolve(forwards, failover.NewHealth()))
	if len(routes) != 1 {
		t.Fatalf("проброс без id в маршруты не идёт: %+v", routes)
	}
	if routes[0].ID != "f1" || routes[0].ActiveRoute != "tunnel" || *routes[0].ActiveCandidate != 0 || routes[0].ActiveNodeID != "n1" {
		t.Fatalf("%+v", routes[0])
	}
}
