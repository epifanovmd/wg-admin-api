package wg

import (
	"regexp"
	"strings"
	"testing"

	"wgadmin/agent/internal/desired"
)

func ptr[T any](value T) *T { return &value }

var iface = desired.Interface{
	Name:        "wg0",
	Enabled:     true,
	ListenPort:  51820,
	AddressCidr: "10.0.0.1/24",
	PrivateKey:  "PRIV",
	MTU:         ptr(1420),
	NatEnabled:  true,
	Peers: []desired.Peer{
		{PublicKey: "PUB1", PresharedKey: ptr("PSK1"), AllowedIPs: "10.0.0.2/32"},
		{PublicKey: "PUB2", AllowedIPs: "10.0.0.3/32"},
	},
}

func TestRenderConfigWithNat(t *testing.T) {
	config := RenderConfig(iface, "ens3")

	for _, want := range []string{
		"PrivateKey = PRIV",
		"ListenPort = 51820",
		"MTU = 1420",
		"PostUp = iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -o ens3 -j MASQUERADE",
		"PostDown = iptables -t nat -D POSTROUTING",
		"PresharedKey = PSK1",
		"PostUp = iptables -A FORWARD -i %i -j ACCEPT",
	} {
		if !strings.Contains(config, want) {
			t.Fatalf("нет %q в\n%s", want, config)
		}
	}
	if strings.Count(config, "[Peer]") != 2 {
		t.Fatal("ожидалось два пира")
	}
}

func TestRenderStripped(t *testing.T) {
	stripped := RenderStripped(iface)

	if regexp.MustCompile(`Address|PostUp|MTU`).MatchString(stripped) {
		t.Fatalf("лишние поля wg-quick:\n%s", stripped)
	}
	if !strings.Contains(stripped, "ListenPort = 51820") {
		t.Fatal("нет порта")
	}
}

func TestFingerprint(t *testing.T) {
	base := Fingerprint(iface, "ens3")

	// Формат фиксирован: его смена перезапустит интерфейсы при обновлении.
	if want := `["10.0.0.1/24",null,51820,1420,true,null,null,"ens3"]`; base != want {
		t.Fatalf("формат: %s != %s", base, want)
	}

	noPeers := iface
	noPeers.Peers = nil
	if Fingerprint(noPeers, "ens3") != base {
		t.Fatal("пиры не должны влиять")
	}

	otherPort := iface
	otherPort.ListenPort = 51821
	if Fingerprint(otherPort, "ens3") == base || Fingerprint(iface, "eth0") == base {
		t.Fatal("порт и egress должны влиять")
	}

	hooks := iface
	hooks.CustomPostUp = ptr("echo <a&b>")
	if got := Fingerprint(hooks, "ens3"); !strings.Contains(got, `"echo <a&b>"`) {
		t.Fatalf("символы без экранирования, как в JSON.stringify: %s", got)
	}
}

func TestParseDump(t *testing.T) {
	dump := strings.Join([]string{
		"wg0\tPRIV\tPUB\t51820\toff",
		"wg0\tPEER1\t(none)\t1.2.3.4:5000\t10.0.0.2/32\t1727000000\t1000\t2000\t25",
		"wg0\tPEER2\t(none)\t(none)\t10.0.0.3/32\t0\t0\t0\toff",
		"wg1\tPRIV2\tPUB2\t51821\toff",
	}, "\n")
	parsed := ParseDump(dump)

	if len(parsed) != 2 || len(parsed["wg1"]) != 0 {
		t.Fatalf("интерфейсы: %v", parsed)
	}

	peers := parsed["wg0"]
	if len(peers) != 2 || *peers[0].Endpoint != "1.2.3.4:5000" || peers[0].RxBytes != 1000 {
		t.Fatalf("пир 1: %+v", peers[0])
	}
	if peers[1].Endpoint != nil || peers[1].LastHandshake != nil {
		t.Fatalf("пир 2: %+v", peers[1])
	}
}

func TestSubnetOf(t *testing.T) {
	if got := SubnetOf("10.8.0.1/24"); got != "10.8.0.0/24" {
		t.Fatal(got)
	}
}

func TestTrimVersion(t *testing.T) {
	if got := TrimVersion("wireguard-tools v1.0.20210914 - https://git.zx2c4.com/wireguard-tools/\n"); got != "wireguard-tools v1.0.20210914" {
		t.Fatal(got)
	}
	if got := TrimVersion(strings.Repeat("x", 100)); len(got) != 64 {
		t.Fatal(len(got))
	}
}
