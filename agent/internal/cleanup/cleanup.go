// Package cleanup — откат созданного агентом на хосте.
package cleanup

import (
	"fmt"
	"path/filepath"
	"regexp"
	"time"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/netcfg"
	"wgadmin/agent/internal/shell"
	"wgadmin/agent/internal/state"
)

// CommandTimeout — таймаут одной команды отката: wg-quick down и iptables
// занимают доли секунды, а весь откат должен уложиться в TimeoutStopSec службы.
const CommandTimeout = 15 * time.Second

var (
	tunnelName = regexp.MustCompile(`^wgt\d+$`)
	ifaceName  = regexp.MustCompile(`^[\w.-]{1,15}$`)
)

// Commands — откат всего, что создал агент: его WG-интерфейсы (PostDown
// снимает их NAT), его IPIP-туннели и цепочки WG_ADMIN_* с переходами.
// Только по собственному списку — чужое не трогается.
func Commands(configDir string, owned state.Owned) []string {
	var commands []string

	for name := range owned.Fingerprints {
		if ifaceName.MatchString(name) {
			commands = append(commands, fmt.Sprintf("wg-quick down %s 2>/dev/null || true", filepath.Join(configDir, name+".conf")))
		}
	}
	for _, name := range owned.Tunnels {
		if tunnelName.MatchString(name) {
			commands = append(commands, fmt.Sprintf("ip link del %s 2>/dev/null || true", name))
		}
	}
	for _, hook := range [][3]string{
		{"nat", netcfg.NatChainPre, "PREROUTING"},
		{"nat", netcfg.NatChainPost, "POSTROUTING"},
		{"filter", netcfg.FilterChainFwd, "FORWARD"},
	} {
		table, chain, parent := hook[0], hook[1], hook[2]
		commands = append(commands,
			fmt.Sprintf("while iptables -t %s -D %s -j %s 2>/dev/null; do :; done", table, parent, chain),
			fmt.Sprintf("iptables -t %s -F %s 2>/dev/null || true", table, chain),
			fmt.Sprintf("iptables -t %s -X %s 2>/dev/null || true", table, chain),
		)
	}

	return commands
}

// Owned откатывает созданное агентом. Файлы (конфиги, кэш) остаются: при
// следующем старте агент поднимет всё заново.
func Owned(configDir, stateFile string) {
	for _, command := range Commands(configDir, state.LoadOwned(stateFile)) {
		shell.Run(command, CommandTimeout)
	}
	logx.Info("Созданное агентом на хосте откачено")
}
