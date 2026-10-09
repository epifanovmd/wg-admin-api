// Package cleanup — уборка созданного воркером на узле.
package cleanup

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/netcfg"
	"wgadmin/agent/internal/shell"
	"wgadmin/agent/internal/state"
)

// CommandTimeout — срок одной команды уборки: wg-quick down и iptables
// занимают доли секунды, а вся уборка должна уложиться в срок агента
// (stopTimeout воркера).
const CommandTimeout = 15 * time.Second

var (
	tunnelName = regexp.MustCompile(`^wgt\d+$`)
	ifaceName  = regexp.MustCompile(`^[\w.-]{1,15}$`)
)

// Commands — уборка всего, что создал воркер: его WG-интерфейсы (PostDown
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

// Owned убирает созданное воркером: интерфейсы, туннели, цепочки, затем
// конфиги его интерфейсов (в них приватные ключи) и файл состояния.
func Owned(configDir, stateFile string) {
	owned := state.LoadOwned(stateFile)

	for _, command := range Commands(configDir, owned) {
		shell.Run(command, CommandTimeout)
	}
	for name := range owned.Fingerprints {
		if ifaceName.MatchString(name) {
			_ = os.Remove(filepath.Join(configDir, name+".conf"))
		}
	}
	_ = os.Remove(stateFile)
	logx.Info("Созданное воркером на узле убрано")
}
