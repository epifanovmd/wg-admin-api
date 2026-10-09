// Воркер socks — SOCKS5-прокси через mTLS по настройке proxies от бэкенда.
// Прокси живут в процессе воркера: остановка воркера закрывает их. Запускает
// воркер агент (github.com/epifanovmd/agent): HTTP на unix-сокете
// AGENT_WORKER_SOCKET.
package main

import (
	"os"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/socks"
	"wgadmin/agent/internal/workerhttp"
)

// version — версия сборки (-ldflags "-X main.version=…", файл VERSION).
var version = "dev"

func main() {
	logx.Info("Воркер socks %s", version)

	service := NewService(socks.New(), version)
	stop := make(chan struct{})
	go service.RetryLoop(stop)

	err := workerhttp.Serve(service.Handler(), func() {
		close(stop)
		service.Close()
	})
	if err != nil {
		logx.Error("%s", err)
		os.Exit(1)
	}
}
