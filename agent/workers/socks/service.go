package main

import (
	"net/http"
	"sync"
	"time"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/socks"
	"wgadmin/agent/internal/workerhttp"
)

// retryEvery — повтор прокси с ошибкой (порт мог освободиться).
const retryEvery = 25 * time.Second

// ProxiesConfig — настройка proxies.
type ProxiesConfig struct {
	Proxies []socks.Config `json:"proxies"`
}

// ProxiesResult — итог применения настройки proxies.
type ProxiesResult struct {
	Version int64          `json:"version"`
	Proxies []socks.Status `json:"proxies"`
	Errors  []string       `json:"errors"`
}

// Service — воркер socks: прокси и их последние статусы.
type Service struct {
	proxies *socks.Proxies
	version string

	mu       sync.Mutex
	configs  []socks.Config
	statuses []socks.Status
}

// NewService — воркер поверх набора прокси.
func NewService(proxies *socks.Proxies, version string) *Service {
	return &Service{proxies: proxies, version: version, statuses: []socks.Status{}}
}

// Apply — привести прокси к списку и запомнить итог.
func (s *Service) Apply(configs []socks.Config) []socks.Status {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.configs = configs
	s.statuses = s.proxies.Apply(configs)

	return s.statuses
}

func failed(statuses []socks.Status) bool {
	for _, status := range statuses {
		if status.Status != "listening" {
			return true
		}
	}

	return false
}

// RetryLoop — повторять применение, пока у какого-то прокси ошибка.
func (s *Service) RetryLoop(stop <-chan struct{}) {
	ticker := time.NewTicker(retryEvery)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}

		s.mu.Lock()
		retry := failed(s.statuses)
		configs := s.configs
		s.mu.Unlock()

		if retry {
			s.Apply(configs)
		}
	}
}

// Close — закрыть все прокси.
func (s *Service) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.proxies.CloseAll()
	s.configs = nil
	s.statuses = []socks.Status{}
}

func (s *Service) snapshot() []socks.Status {
	s.mu.Lock()
	defer s.mu.Unlock()

	return append([]socks.Status{}, s.statuses...)
}

// Handler — HTTP воркера socks.
func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		workerhttp.JSON(w, http.StatusOK, map[string]any{
			"ok":   true,
			"info": map[string]any{"version": s.version, "proxies": s.snapshot()},
		})
	})
	mux.HandleFunc("GET /manifest", func(w http.ResponseWriter, _ *http.Request) {
		workerhttp.JSON(w, http.StatusOK, Manifest(s.version))
	})
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		workerhttp.JSON(w, http.StatusOK, map[string]any{"proxies": s.proxies.Stats()})
	})
	mux.HandleFunc("GET /proxies", func(w http.ResponseWriter, _ *http.Request) {
		workerhttp.JSON(w, http.StatusOK, map[string]any{"proxies": s.snapshot()})
	})

	mux.HandleFunc("PUT /config/proxies", func(w http.ResponseWriter, r *http.Request) {
		var config ProxiesConfig
		version, err := workerhttp.ReadConfig(r, &config)
		if err != nil {
			workerhttp.Error(w, http.StatusBadRequest, err.Error())

			return
		}

		statuses := s.Apply(config.Proxies)
		result := ProxiesResult{Version: version, Proxies: statuses, Errors: []string{}}
		for _, status := range statuses {
			if status.Status != "listening" {
				result.Errors = append(result.Errors, status.ID+": "+status.Message)
			}
		}
		logx.Info("Настройка proxies v%d: прокси %d, ошибок %d", version, len(statuses), len(result.Errors))
		workerhttp.JSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /config/proxies", func(w http.ResponseWriter, _ *http.Request) {
		s.Close()
		workerhttp.NoContent(w)
	})
	mux.HandleFunc("POST /cleanup", func(w http.ResponseWriter, _ *http.Request) {
		s.Close()
		workerhttp.NoContent(w)
	})

	mux.HandleFunc("/", workerhttp.NotFound)

	return mux
}
