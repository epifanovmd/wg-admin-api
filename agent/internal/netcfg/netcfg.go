package netcfg

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/shell"
)

// Цепочки агента: пересобираются целиком, чужие правила не трогаются.
const (
	NatChainPre    = "WG_ADMIN_PRE"
	NatChainPost   = "WG_ADMIN_POST"
	FilterChainFwd = "WG_ADMIN_FWD"
	commandTimeout = 30 * time.Second
)

var (
	linkFlags = regexp.MustCompile(`<([^>]*)>`)
	linkMtu   = regexp.MustCompile(` mtu (\d+)`)
)

// TunnelMatches — существующий туннель совпадает с желаемым (тот же remote,
// адрес, MTU и поднят): пересоздание рвёт трафик через релей.
// link — `ip -d -o link show`, addr — `ip -o -4 addr show dev`.
func TunnelMatches(link, addr string, tunnel protocol.Tunnel) bool {
	flags := []string{}
	if match := linkFlags.FindStringSubmatch(link); match != nil {
		flags = strings.Split(match[1], ",")
	}

	up := false
	for _, flag := range flags {
		if flag == "UP" {
			up = true
		}
	}

	mtu := 0
	if match := linkMtu.FindStringSubmatch(link); match != nil {
		mtu, _ = strconv.Atoi(match[1])
	}

	remote := ""
	if match := ipipRemote.FindStringSubmatch(link); match != nil {
		remote = match[1]
	}

	cidr := fmt.Sprintf("%s/%d", tunnel.LocalTunnelIP, tunnel.Prefix)
	hasAddr := false
	for _, field := range strings.Fields(addr) {
		if field == cidr {
			hasAddr = true
		}
	}

	return up && mtu == tunnel.MTU && remote == tunnel.RemoteHost && hasAddr
}

// ApplyTunnels приводит IPIP-туннели к желаемому списку.
func ApplyTunnels(desired []protocol.Tunnel, previous []string) error {
	if len(desired) > 0 {
		shell.Run("modprobe ipip || true", commandTimeout)
	}

	want := map[string]bool{}
	for _, tunnel := range desired {
		want[tunnel.Name] = true
	}

	for _, name := range previous {
		if !want[name] {
			logx.Info("Туннель %s больше не нужен — удаляю", name)
			shell.Run(fmt.Sprintf("ip tunnel del %s 2>/dev/null || true", name), commandTimeout)
		}
	}

	for _, tunnel := range desired {
		link := shell.Exec(commandTimeout, "ip", "-d", "-o", "link", "show", tunnel.Name)
		addr := shell.Exec(commandTimeout, "ip", "-o", "-4", "addr", "show", "dev", tunnel.Name)

		if TunnelMatches(link.Stdout, addr.Stdout, tunnel) {
			continue
		}

		shell.Run(fmt.Sprintf("ip tunnel del %s 2>/dev/null || true", tunnel.Name), commandTimeout)
		steps := [][]string{
			{"tunnel", "add", tunnel.Name, "mode", "ipip", "remote", tunnel.RemoteHost, "ttl", "64"},
			{"addr", "add", fmt.Sprintf("%s/%d", tunnel.LocalTunnelIP, tunnel.Prefix), "dev", tunnel.Name},
			{"link", "set", tunnel.Name, "mtu", strconv.Itoa(tunnel.MTU), "up"},
		}
		for _, args := range steps {
			if _, err := shell.Must(commandTimeout, "ip", args...); err != nil {
				return err
			}
		}
		shell.Run(fmt.Sprintf("sysctl -qw net.ipv4.conf.%s.rp_filter=0 || true", tunnel.Name), commandTimeout)
		logx.Info("Туннель %s: %s ↔ %s (remote %s)", tunnel.Name, tunnel.LocalTunnelIP, tunnel.RemoteTunnelIP, tunnel.RemoteHost)
	}

	return nil
}

// ForwardRules — аргументы iptables пробросов: DNAT входящего порта,
// masquerade к цели и разрешение пересылки в обе стороны (без него на
// хосте с Docker — FORWARD policy DROP — проброс молча режется).
func ForwardRules(forwards []protocol.Forward) [][]string {
	var rules [][]string

	for _, forward := range forwards {
		port := strconv.Itoa(forward.ListenPort)
		targetPort := strconv.Itoa(forward.TargetPort)

		rules = append(rules,
			[]string{"-t", "nat", "-A", NatChainPre, "-p", forward.Proto, "--dport", port, "-j", "DNAT", "--to-destination", forward.TargetIP + ":" + targetPort},
			[]string{"-t", "nat", "-A", NatChainPost, "-d", forward.TargetIP, "-p", forward.Proto, "--dport", targetPort, "-j", "MASQUERADE"},
			[]string{"-t", "filter", "-A", FilterChainFwd, "-d", forward.TargetIP, "-p", forward.Proto, "--dport", targetPort, "-j", "ACCEPT"},
			[]string{"-t", "filter", "-A", FilterChainFwd, "-s", forward.TargetIP, "-p", forward.Proto, "--sport", targetPort, "-j", "ACCEPT"},
		)
	}

	return rules
}

// ApplyForwards пересобирает цепочки пробросов; переход в FORWARD — первым
// правилом, раньше политики DROP и цепочек Docker.
func ApplyForwards(forwards []protocol.Forward) error {
	shell.Run("sysctl -qw net.ipv4.ip_forward=1 || true", commandTimeout)

	for _, hook := range []struct{ table, chain, parent, insert string }{
		{"nat", NatChainPre, "PREROUTING", "-A"},
		{"nat", NatChainPost, "POSTROUTING", "-A"},
		{"filter", FilterChainFwd, "FORWARD", "-I"},
	} {
		position := ""
		if hook.insert == "-I" {
			position = " 1"
		}

		shell.Run(fmt.Sprintf("iptables -t %s -N %s 2>/dev/null || true", hook.table, hook.chain), commandTimeout)
		shell.Run(fmt.Sprintf("iptables -t %s -C %s -j %s 2>/dev/null || iptables -t %s %s %s%s -j %s",
			hook.table, hook.parent, hook.chain, hook.table, hook.insert, hook.parent, position, hook.chain), commandTimeout)
		shell.Run(fmt.Sprintf("iptables -t %s -F %s", hook.table, hook.chain), commandTimeout)
	}

	for _, args := range ForwardRules(forwards) {
		if _, err := shell.Must(commandTimeout, "iptables", args...); err != nil {
			return err
		}
	}
	for _, forward := range forwards {
		logx.Info("Проброс %s/%d → %s:%d", forward.Proto, forward.ListenPort, forward.TargetIP, forward.TargetPort)
	}

	return nil
}

// HasIptables — iptables доступен.
func HasIptables() bool {
	return shell.Run("command -v iptables", commandTimeout).Code == 0
}

// ReadHostNetwork — адреса и IPIP-туннели хоста.
func ReadHostNetwork() HostNetwork {
	addrs := shell.Exec(commandTimeout, "ip", "-o", "-4", "addr", "show")
	links := shell.Exec(commandTimeout, "ip", "-d", "-o", "link", "show", "type", "ipip")

	return HostNetwork{Addrs: ParseIPv4Addrs(addrs.Stdout), Tunnels: ParseIpipTunnels(links.Stdout)}
}
