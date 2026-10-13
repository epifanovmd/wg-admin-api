package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/epifanovmd/agent/protocol"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/socks"
)

// ConfigProxies — ключ настроек воркера.
const ConfigProxies = "proxies"

// retryEvery — повтор прокси с ошибкой (порт мог освободиться).
const retryEvery = 25 * time.Second

// maxHealthMessage — длина сообщения пульса, символов.
const maxHealthMessage = 500

// ProxiesConfig — настройка proxies.
type ProxiesConfig struct {
	Proxies []socks.Config `json:"proxies"`
}

// Service — воркер socks: прокси и их последние статусы.
type Service struct {
	proxies *socks.Proxies

	mu       sync.Mutex
	configs  []socks.Config
	statuses []socks.Status
}

// NewService — воркер поверх набора прокси.
func NewService(proxies *socks.Proxies) *Service {
	return &Service{proxies: proxies, statuses: []socks.Status{}}
}

// Configure — ключ настроек от агента (worker.Options.Configure): data nil — ключ удалён,
// прокси закрываются. Прокси с ошибкой (порт занят) — не отказ в настройке: он в пульсе и
// повторяется.
func (s *Service) Configure(_ context.Context, key string, data json.RawMessage) error {
	if key != ConfigProxies {
		return protocol.NewError(protocol.CodeConfigRejected, fmt.Sprintf("ключ %q воркеру socks не нужен", key))
	}
	if data == nil {
		s.Close()

		return nil
	}
	var config ProxiesConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return protocol.NewError(protocol.CodeConfigRejected, "proxies: "+err.Error())
	}

	statuses := s.Apply(config.Proxies)
	logx.Info("Настройка proxies: прокси %d, ошибок %d", len(statuses), len(failures(statuses)))

	return nil
}

// Apply — привести прокси к списку и запомнить итог.
func (s *Service) Apply(configs []socks.Config) []socks.Status {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.configs = configs
	s.statuses = s.proxies.Apply(configs)

	return s.statuses
}

// failures — «id: причина» прокси, которые не слушают.
func failures(statuses []socks.Status) []string {
	var result []string

	for _, status := range statuses {
		if status.Status != "listening" {
			result = append(result, status.ID+": "+status.Message)
		}
	}

	return result
}

// RetryLoop — повторять применение, пока у какого-то прокси ошибка.
func (s *Service) RetryLoop(ctx context.Context) {
	ticker := time.NewTicker(retryEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		s.retryOnce()
	}
}

func (s *Service) retryOnce() {
	s.mu.Lock()
	retry := len(failures(s.statuses)) > 0
	configs := s.configs
	s.mu.Unlock()

	if retry {
		s.Apply(configs)
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

// Health — пульс: прокси, который не слушает, — ok: false с причиной; метрики — счётчики
// прокси.
func (s *Service) Health() protocol.Health {
	s.mu.Lock()
	failed := failures(s.statuses)
	s.mu.Unlock()

	health := protocol.Health{OK: len(failed) == 0}
	if !health.OK {
		health.Message = strings.Join(failed, "; ")
		if runes := []rune(health.Message); len(runes) > maxHealthMessage {
			health.Message = string(runes[:maxHealthMessage])
		}
	}
	health.Metrics, _ = json.Marshal(map[string]any{"proxies": s.proxies.Stats()})

	return health
}
