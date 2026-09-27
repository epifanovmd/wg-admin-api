package netcfg

import (
	"fmt"
	"strings"
	"testing"

	"wgadmin/agent/internal/protocol"
)

var tunnel = protocol.Tunnel{
	Name: "wgt0", RemoteHost: "203.0.113.20",
	LocalTunnelIP: "10.99.0.1", RemoteTunnelIP: "10.99.0.2", Prefix: 30, MTU: 1480,
}

func link(remote string, mtu int, flags string) string {
	return fmt.Sprintf(`5: wgt0@NONE: <%s> mtu %d qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\    link/ipip 0.0.0.0 peer %s promiscuity 0 minmtu 0 maxmtu 0 \    ipip ipip remote %s local any ttl 64 pmtudisc`, flags, mtu, remote, remote)
}

func addr(cidr string) string {
	return fmt.Sprintf(`5: wgt0    inet %s scope global wgt0\       valid_lft forever preferred_lft forever`, cidr)
}

const up = "POINTOPOINT,NOARP,UP,LOWER_UP"

func TestTunnelMatches(t *testing.T) {
	// Пересоздание туннеля рвёт трафик через релей — только при отличиях.
	if !TunnelMatches(link("203.0.113.20", 1480, up), addr("10.99.0.1/30"), tunnel) {
		t.Fatal("тот же туннель")
	}
	for name, got := range map[string]bool{
		"remote": TunnelMatches(link("198.51.100.1", 1480, up), addr("10.99.0.1/30"), tunnel),
		"адрес":  TunnelMatches(link("203.0.113.20", 1480, up), addr("10.99.0.5/30"), tunnel),
		"mtu":    TunnelMatches(link("203.0.113.20", 1400, up), addr("10.99.0.1/30"), tunnel),
		"опущен": TunnelMatches(link("203.0.113.20", 1480, "POINTOPOINT,NOARP"), addr("10.99.0.1/30"), tunnel),
		"нет":    TunnelMatches("", "", tunnel),
	} {
		if got {
			t.Fatalf("%s: должен пересоздаваться", name)
		}
	}
}

func TestForwardRules(t *testing.T) {
	joined := func(rules [][]string) string {
		var lines []string
		for _, rule := range rules {
			lines = append(lines, strings.Join(rule, " "))
		}
		return strings.Join(lines, "\n")
	}

	udp := joined(ForwardRules([]protocol.Forward{{Proto: "udp", ListenPort: 51820, TargetIP: "10.99.0.2", TargetPort: 51820}}))
	for _, want := range []string{
		"-t nat -A WG_ADMIN_PRE -p udp --dport 51820 -j DNAT --to-destination 10.99.0.2:51820",
		"-t nat -A WG_ADMIN_POST -d 10.99.0.2 -p udp --dport 51820 -j MASQUERADE",
		"-t filter -A WG_ADMIN_FWD -d 10.99.0.2 -p udp --dport 51820 -j ACCEPT",
		"-t filter -A WG_ADMIN_FWD -s 10.99.0.2 -p udp --sport 51820 -j ACCEPT",
	} {
		if !strings.Contains(udp, want) {
			t.Fatalf("нет правила %q", want)
		}
	}

	tcp := joined(ForwardRules([]protocol.Forward{{Proto: "tcp", ListenPort: 8443, TargetIP: "10.99.0.2", TargetPort: 8444}}))
	if !strings.Contains(tcp, "-t nat -A WG_ADMIN_PRE -p tcp --dport 8443 -j DNAT --to-destination 10.99.0.2:8444") {
		t.Fatal(tcp)
	}
}

// Хост 198.51.100.10: чужой туннель tun-server 10.99.0.1/30 до 203.0.113.20,
// агенту нужен wgt0 с тем же адресом и хостом.
const hostAddrs = `1: lo    inet 127.0.0.1/8 scope host lo\       valid_lft forever preferred_lft forever
2: eth0    inet 198.51.100.10/24 metric 100 brd 198.51.100.255 scope global eth0\       valid_lft forever preferred_lft forever
2255: tun-server    inet 10.99.0.1/30 scope global tun-server\       valid_lft forever preferred_lft forever
`

const hostLinks = `2172: tunl0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN mode DEFAULT group default qlen 1000\    link/ipip 0.0.0.0 brd 0.0.0.0 promiscuity 0 \    ipip any remote any local any ttl inherit nopmtudisc
2255: tun-server@NONE: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1480 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\    link/ipip 198.51.100.10 peer 203.0.113.20 promiscuity 0 \    ipip ipip remote 203.0.113.20 local 198.51.100.10 ttl 64 pmtudisc
`

func TestParseHost(t *testing.T) {
	addrs := ParseIPv4Addrs(hostAddrs)
	if len(addrs) != 3 || addrs[2] != (HostAddr{Dev: "tun-server", Cidr: "10.99.0.1/30"}) {
		t.Fatalf("%+v", addrs)
	}

	// tunl0 — базовое устройство модуля ipip (remote any), не туннель.
	tunnels := ParseIpipTunnels(hostLinks)
	if len(tunnels) != 1 || tunnels[0] != (HostTunnel{Dev: "tun-server", Remote: "203.0.113.20"}) {
		t.Fatalf("%+v", tunnels)
	}
}

func TestTunnelConflict(t *testing.T) {
	host := HostNetwork{Addrs: ParseIPv4Addrs(hostAddrs), Tunnels: ParseIpipTunnels(hostLinks)}
	base := protocol.Tunnel{Name: "wgt0", RemoteHost: "203.0.113.20", LocalTunnelIP: "10.99.0.1", RemoteTunnelIP: "10.99.0.2", Prefix: 30, MTU: 1480}

	if got := TunnelConflict(base, host); !strings.Contains(got, "tun-server") {
		t.Fatalf("подсеть: %q", got)
	}

	otherNet := base
	otherNet.LocalTunnelIP = "10.98.0.1"
	if got := TunnelConflict(otherNet, host); !strings.Contains(got, "203.0.113.20") {
		t.Fatalf("чужой туннель к тому же хосту: %q", got)
	}

	free := otherNet
	free.RemoteHost = "192.0.2.30"
	if got := TunnelConflict(free, host); got != "" {
		t.Fatalf("конфликта нет: %q", got)
	}

	own := HostNetwork{Addrs: []HostAddr{{Dev: "wgt0", Cidr: "10.99.0.1/30"}}, Tunnels: []HostTunnel{{Dev: "wgt0", Remote: "203.0.113.20"}}}
	if got := TunnelConflict(base, own); got != "" {
		t.Fatalf("свой туннель — не конфликт: %q", got)
	}
}

func TestForwardConflict(t *testing.T) {
	ports := HostPorts{UDP: []int{53, 51820}, TCP: []int{22, 8443}}

	if ForwardConflict(protocol.Forward{Proto: "udp", ListenPort: 51820}, ports) == "" {
		t.Fatal("udp 51820 занят")
	}
	if ForwardConflict(protocol.Forward{Proto: "tcp", ListenPort: 51820}, ports) != "" {
		t.Fatal("tcp 51820 свободен")
	}
	if ForwardConflict(protocol.Forward{Proto: "tcp", ListenPort: 8443}, ports) == "" {
		t.Fatal("tcp 8443 занят")
	}
}
