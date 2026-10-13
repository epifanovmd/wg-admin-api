// Воркер wg — WireGuard-интерфейсы, IPIP-туннели и пробросы портов узла по
// настройке state от бэкенда, пробы связности по настройке probes. Запускает
// его агент (github.com/epifanovmd/agent); связь — пакет worker агента.
//
// Окружение: WG_CONFIG_DIR — конфиги wg-quick (/etc/wireguard), WG_STATE_DIR —
// что создал воркер (/var/lib/wg-admin), WG_DRY_RUN=1 — имитация без
// системных команд (каталоги по умолчанию — в WORKER_STATE_DIR или $TMPDIR/wg-admin-dry).
//
// wg cleanup — убрать созданное воркером на узле (его выполняет ./cleanup после остановки).
package main

import (
	"context"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/epifanovmd/agent/worker"

	"wgadmin/agent/internal/logx"
)

// version — версия сборки (-ldflags "-X main.version=…", файл VERSION).
var version = "dev"

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}

	return fallback
}

// system — система узла по окружению: имитация (WG_DRY_RUN=1) или настоящая.
func system() (System, bool) {
	if os.Getenv("WG_DRY_RUN") == "1" {
		base := env("WORKER_STATE_DIR", filepath.Join(os.TempDir(), "wg-admin-dry"))
		configDir := env("WG_CONFIG_DIR", filepath.Join(base, "wireguard"))
		stateDir := env("WG_STATE_DIR", filepath.Join(base, "state"))
		logx.Info("Воркер wg %s — имитация (WG_DRY_RUN=1): конфиги в %s, состояние в %s", version, configDir, stateDir)

		return newDrySystem(configDir, stateDir), true
	}

	configDir := env("WG_CONFIG_DIR", "/etc/wireguard")
	stateDir := env("WG_STATE_DIR", "/var/lib/wg-admin")
	logx.Info("Воркер wg %s: конфиги в %s, состояние в %s", version, configDir, stateDir)

	return newRealSystem(configDir, stateDir), false
}

func main() {
	sys, dryRun := system()

	if len(os.Args) > 1 && os.Args[1] == "cleanup" {
		sys.Cleanup()

		return
	}
	if !dryRun {
		if err := sys.Ready(); err != nil {
			logx.Error("%s", err)
		}
	}

	service := NewService(sys)
	w, err := worker.New(worker.Options{
		Version:   version,
		Manifest:  Manifest(),
		Configure: service.Configure,
		Commands:  map[string]worker.CommandFunc{CommandRestart: service.RestartCommand},
		Health:    service.Health,
		Log:       logx.Warn,
	})
	if err != nil {
		logx.Error("%s", err)
		os.Exit(1)
	}
	service.SetEvents(w)

	// SIGTERM ничего не разбирает: интерфейсы и правила остаются, уборка — wg cleanup.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	go service.Run(ctx)
	if err := w.Run(ctx); err != nil {
		logx.Error("%s", err)
		os.Exit(1)
	}
}
