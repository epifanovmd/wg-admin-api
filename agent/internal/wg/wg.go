// Package wg — WireGuard через wireguard-tools: конфиги wg-quick, дамп
// счётчиков, версия.
package wg

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/shell"
)

// quickTimeout — срок wg и ip в метриках и самочувствии: агент ждёт их
// ответа 2 с.
const quickTimeout = 1500 * time.Millisecond

// Dump — интерфейс → пиры.
type Dump map[string][]desired.PeerStat

// ParseDump разбирает `wg show all dump`: 5 полей — интерфейс, 9 — пир.
func ParseDump(output string) Dump {
	result := Dump{}

	for _, line := range strings.Split(output, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}

		parts := strings.Split(line, "\t")

		switch len(parts) {
		case 5:
			if _, ok := result[parts[0]]; !ok {
				result[parts[0]] = []desired.PeerStat{}
			}
		case 9:
			peer := desired.PeerStat{PublicKey: parts[1]}

			if parts[3] != "(none)" {
				endpoint := parts[3]
				peer.Endpoint = &endpoint
			}
			if handshake, _ := strconv.ParseInt(parts[5], 10, 64); handshake > 0 {
				peer.LastHandshake = &handshake
			}
			peer.RxBytes, _ = strconv.ParseInt(parts[6], 10, 64)
			peer.TxBytes, _ = strconv.ParseInt(parts[7], 10, 64)
			result[parts[0]] = append(result[parts[0]], peer)
		}
	}

	return result
}

// ReadDump — счётчики всех интерфейсов.
func ReadDump() (Dump, error) {
	result := shell.Exec(quickTimeout, "wg", "show", "all", "dump")
	if result.Code != 0 {
		return nil, fmt.Errorf("wg show all dump: %s", strings.TrimSpace(result.Stderr))
	}

	return ParseDump(result.Stdout), nil
}

// Version — «wireguard-tools v1.0.…» без ссылки; "" — wg не установлен.
func Version() string {
	result := shell.Exec(quickTimeout, "wg", "--version")
	if result.Code != 0 {
		return ""
	}

	return TrimVersion(result.Stdout)
}

// TrimVersion — первая часть вывода `wg --version`, не длиннее 64 символов.
func TrimVersion(output string) string {
	version := strings.SplitN(strings.TrimSpace(output), " - ", 2)[0]
	if len(version) > 64 {
		version = version[:64]
	}

	return version
}

// IsUp — интерфейс существует.
func IsUp(name string) bool {
	return shell.Exec(5*time.Second, "ip", "link", "show", name).Code == 0
}

// DefaultEgress — интерфейс маршрута по умолчанию (для masquerade).
func DefaultEgress() string {
	result := shell.Exec(5*time.Second, "ip", "route", "show", "default")
	fields := strings.Fields(result.Stdout)

	for i := 0; i+1 < len(fields); i++ {
		if fields[i] == "dev" {
			return fields[i+1]
		}
	}

	return "eth0"
}

func natRules(subnet, egress, action string) []string {
	return []string{
		fmt.Sprintf("iptables %s FORWARD -i %%i -j ACCEPT", action),
		fmt.Sprintf("iptables %s FORWARD -o %%i -j ACCEPT", action),
		fmt.Sprintf("iptables -t nat %s POSTROUTING -s %s -o %s -j MASQUERADE", action, subnet, egress),
	}
}

// SubnetOf — сеть адреса интерфейса: 10.0.0.1/24 → 10.0.0.0/24.
func SubnetOf(addressCidr string) string {
	_, network, err := net.ParseCIDR(addressCidr)
	if err != nil {
		return addressCidr
	}

	return network.String()
}

func peerLines(peers []desired.Peer) []string {
	var lines []string

	for _, peer := range peers {
		lines = append(lines, "", "[Peer]", "PublicKey = "+peer.PublicKey)
		if peer.PresharedKey != nil && *peer.PresharedKey != "" {
			lines = append(lines, "PresharedKey = "+*peer.PresharedKey)
		}
		lines = append(lines, "AllowedIPs = "+peer.AllowedIPs)
	}

	return lines
}

// RenderConfig — полный конфиг wg-quick интерфейса.
func RenderConfig(iface desired.Interface, egress string) string {
	address := iface.AddressCidr
	if iface.AddressV6Cidr != nil && *iface.AddressV6Cidr != "" {
		address += ", " + *iface.AddressV6Cidr
	}

	var postUp, postDown []string

	if iface.NatEnabled {
		subnet := SubnetOf(iface.AddressCidr)
		postUp = append(postUp, natRules(subnet, egress, "-A")...)
		postDown = append(postDown, natRules(subnet, egress, "-D")...)
	}
	if iface.CustomPostUp != nil && *iface.CustomPostUp != "" {
		postUp = append(postUp, *iface.CustomPostUp)
	}
	if iface.CustomPostDown != nil && *iface.CustomPostDown != "" {
		postDown = append(postDown, *iface.CustomPostDown)
	}

	lines := []string{
		"# managed by wg-admin — не редактировать вручную",
		"[Interface]",
		"PrivateKey = " + iface.PrivateKey,
		"Address = " + address,
		"ListenPort = " + strconv.Itoa(iface.ListenPort),
	}
	if iface.MTU != nil && *iface.MTU > 0 {
		lines = append(lines, "MTU = "+strconv.Itoa(*iface.MTU))
	}
	for _, rule := range postUp {
		lines = append(lines, "PostUp = "+rule)
	}
	for _, rule := range postDown {
		lines = append(lines, "PostDown = "+rule)
	}

	lines = append(lines, peerLines(iface.Peers)...)
	lines = append(lines, "")

	return strings.Join(lines, "\n")
}

// RenderStripped — конфиг для `wg syncconf` (без полей wg-quick).
func RenderStripped(iface desired.Interface) string {
	lines := []string{
		"[Interface]",
		"PrivateKey = " + iface.PrivateKey,
		"ListenPort = " + strconv.Itoa(iface.ListenPort),
	}

	lines = append(lines, peerLines(iface.Peers)...)
	lines = append(lines, "")

	return strings.Join(lines, "\n")
}

// Fingerprint — отпечаток interface-секции: изменение требует down/up, а
// не syncconf. Формат (JSON-массив) фиксирован: его смена перезапустит
// интерфейсы при обновлении воркера.
func Fingerprint(iface desired.Interface, egress string) string {
	var buf bytes.Buffer

	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode([]any{
		iface.AddressCidr,
		iface.AddressV6Cidr,
		iface.ListenPort,
		iface.MTU,
		iface.NatEnabled,
		iface.CustomPostUp,
		iface.CustomPostDown,
		egress,
	})

	return strings.TrimSuffix(buf.String(), "\n")
}
