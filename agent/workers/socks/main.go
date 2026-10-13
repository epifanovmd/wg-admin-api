// Воркер socks — SOCKS5-прокси через mTLS по настройке proxies от бэкенда.
// Прокси живут в процессе воркера: остановка воркера закрывает их, уборка не
// нужна. Запускает воркер агент (github.com/epifanovmd/agent); связь — пакет
// worker агента.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/epifanovmd/agent/worker"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/socks"
)

// version — версия сборки (-ldflags "-X main.version=…", файл VERSION).
var version = "dev"

func main() {
	logx.Info("Воркер socks %s", version)

	service := NewService(socks.New())
	w, err := worker.New(worker.Options{
		Version:   version,
		Manifest:  Manifest(),
		Configure: service.Configure,
		Health:    service.Health,
		Log:       logx.Warn,
	})
	if err != nil {
		logx.Error("%s", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	defer service.Close()

	go service.RetryLoop(ctx)
	if err := w.Run(ctx); err != nil {
		logx.Error("%s", err)
		os.Exit(1)
	}
}
