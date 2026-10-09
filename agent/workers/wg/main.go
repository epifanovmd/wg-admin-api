// Воркер wg — WireGuard-интерфейсы, IPIP-туннели и пробросы портов узла по
// настройке state от бэкенда, пробы связности по настройке probes. Запускает
// его агент (github.com/epifanovmd/agent): HTTP на unix-сокете
// AGENT_WORKER_SOCKET.
//
// Окружение: WG_CONFIG_DIR — конфиги wg-quick (/etc/wireguard), WG_STATE_DIR —
// что создал воркер (/var/lib/wg-admin), WG_DRY_RUN=1 — имитация без
// системных команд (каталоги по умолчанию — в $TMPDIR/wg-admin-dry).
package main

import (
	"os"
	"path/filepath"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/workerhttp"
)

// version — версия сборки (-ldflags "-X main.version=…", файл VERSION).
var version = "dev"

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}

	return fallback
}

func main() {
	dryRun := os.Getenv("WG_DRY_RUN") == "1"

	var sys System
	if dryRun {
		base := filepath.Join(os.TempDir(), "wg-admin-dry")
		configDir := env("WG_CONFIG_DIR", filepath.Join(base, "wireguard"))
		stateDir := env("WG_STATE_DIR", filepath.Join(base, "state"))
		sys = newDrySystem(configDir, stateDir)
		logx.Info("Воркер wg %s — имитация (WG_DRY_RUN=1): конфиги в %s, состояние в %s", version, configDir, stateDir)
	} else {
		configDir := env("WG_CONFIG_DIR", "/etc/wireguard")
		stateDir := env("WG_STATE_DIR", "/var/lib/wg-admin")
		sys = newRealSystem(configDir, stateDir)
		logx.Info("Воркер wg %s: конфиги в %s, состояние в %s", version, configDir, stateDir)
		if err := sys.Ready(); err != nil {
			logx.Error("%s", err)
		}
	}

	service := NewService(sys, workerhttp.AgentFromEnv(), version, dryRun)
	stop := make(chan struct{})
	service.Run(stop)

	if err := workerhttp.Serve(service.Handler(), func() { close(stop) }); err != nil {
		logx.Error("%s", err)
		os.Exit(1)
	}
}
