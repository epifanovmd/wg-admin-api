package cleanup

import (
	"strings"
	"testing"

	"wgadmin/agent/internal/state"
)

func TestCommandsOnlyOwned(t *testing.T) {
	commands := strings.Join(Commands("/etc/wireguard", state.Owned{
		Fingerprints: map[string]string{"wg0": "x", "bad name;rm": "x"},
		Tunnels:      []string{"wgt0", "tun-server"},
	}), "\n")

	for _, want := range []string{
		"wg-quick down /etc/wireguard/wg0.conf",
		"ip link del wgt0",
		"iptables -t nat -D PREROUTING -j WG_ADMIN_PRE",
		"iptables -t filter -X WG_ADMIN_FWD",
	} {
		if !strings.Contains(commands, want) {
			t.Fatalf("нет %q", want)
		}
	}
	// Чужой туннель и подозрительное имя — не трогаем.
	if strings.Contains(commands, "tun-server") || strings.Contains(commands, "rm") {
		t.Fatal(commands)
	}
}
