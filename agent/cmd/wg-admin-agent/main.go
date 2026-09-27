// wg-admin-agent — агент ноды WireGuard: применяет желаемое состояние
// бэкенда и шлёт статистику.
//
//	wg-admin-agent          — запуск (под systemd или в контейнере)
//	wg-admin-agent cleanup  — откатить созданное агентом на хосте
//	wg-admin-agent version  — версия и sha256 бинаря
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"wgadmin/agent/internal/agent"
	"wgadmin/agent/internal/cleanup"
	"wgadmin/agent/internal/config"
	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/update"
)

// version — задаётся при сборке: -ldflags "-X main.version=…".
var version = "dev"

func binaryPath() string {
	path, err := os.Executable()
	if err != nil {
		return os.Args[0]
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}

	return path
}

func main() {
	dir := config.ConfigDir()
	paths := update.Paths{Binary: binaryPath(), Marker: filepath.Join(dir, ".agent-update")}

	switch arg := firstArg(); arg {
	case "cleanup":
		cleanup.Owned(dir, filepath.Join(dir, ".wg-admin-state.json"))

		return
	case "version", "--version", "-v":
		hash, _ := update.FileHash(paths.Binary)
		fmt.Printf("wg-admin-agent %s %s\n", version, hash)

		return
	case "", "run":
	default:
		fmt.Fprintf(os.Stderr, "неизвестная команда %q: run | cleanup | version\n", arg)
		os.Exit(2)
	}

	// Новая версия трижды не вышла на связь — вернуть прежнюю и перезапуститься.
	if rolledBack, err := update.Boot(paths); err != nil {
		logx.Warn("Проверка обновления: %s", err)
	} else if rolledBack {
		logx.Warn("Новая версия не вышла на связь — откат на прежнюю")
		if err := syscall.Exec(paths.Binary, os.Args, os.Environ()); err != nil {
			logx.Error("Перезапуск после отката: %s", err)
			os.Exit(1)
		}
	}

	cfg, err := config.Load(version)
	if err != nil {
		logx.Error("%s", err)
		os.Exit(1)
	}

	agent.New(cfg, paths).Run()
}

func firstArg() string {
	if len(os.Args) > 1 {
		return os.Args[1]
	}

	return ""
}
