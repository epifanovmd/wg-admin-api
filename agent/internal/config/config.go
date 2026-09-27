// Package config — конфигурация агента из окружения.
package config

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// DefaultConfigDir — каталог конфигов WireGuard и состояния агента на хосте
// (WG_AGENT_CONFIG_DIR).
const DefaultConfigDir = "/etc/wg-admin/wireguard"

// Config — параметры агента.
type Config struct {
	BackendURL     string
	AgentKey       string
	ConfigDir      string
	StateFile      string
	DesiredFile    string
	PollWait       time.Duration
	StatsInterval  time.Duration
	ReportInterval time.Duration
	// Transport — связь с бэкендом: "auto" (канал WebSocket, HTTP при его
	// неподдержке) или "http" (только HTTP-протокол).
	Transport string
	Version   string
}

// ConfigDir — каталог конфигов (WG_AGENT_CONFIG_DIR или по умолчанию).
func ConfigDir() string {
	if dir := os.Getenv("WG_AGENT_CONFIG_DIR"); dir != "" {
		return dir
	}

	return DefaultConfigDir
}

func millis(name string, fallback int) time.Duration {
	if raw := os.Getenv(name); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			return time.Duration(value) * time.Millisecond
		}
	}

	return time.Duration(fallback) * time.Millisecond
}

// transport — WG_AGENT_TRANSPORT: "http" или "auto" (по умолчанию).
func transport() string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("WG_AGENT_TRANSPORT")), "http") {
		return "http"
	}

	return "auto"
}

// Load читает конфигурацию; без адреса бэкенда и ключа — ошибка.
func Load(version string) (Config, error) {
	backend := strings.TrimRight(os.Getenv("WG_AGENT_BACKEND_URL"), "/")
	key := os.Getenv("WG_AGENT_KEY")

	if backend == "" || key == "" {
		return Config{}, errors.New("WG_AGENT_BACKEND_URL и WG_AGENT_KEY обязательны")
	}

	dir := ConfigDir()

	return Config{
		BackendURL:     backend,
		AgentKey:       key,
		ConfigDir:      dir,
		StateFile:      filepath.Join(dir, ".wg-admin-state.json"),
		DesiredFile:    filepath.Join(dir, ".wg-admin-desired.json"),
		PollWait:       millis("WG_AGENT_POLL_WAIT_MS", 25_000),
		StatsInterval:  millis("WG_AGENT_STATS_INTERVAL_MS", 2_000),
		ReportInterval: millis("WG_AGENT_REPORT_INTERVAL_MS", 60_000),
		Transport:      transport(),
		Version:        version,
	}, nil
}

var localHosts = map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}

// IsInsecureBackendURL — бэкенд по http за пределами хоста: ключ агента и
// приватные ключи интерфейсов идут в открытом виде.
func IsInsecureBackendURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}

	return parsed.Scheme == "http" && !localHosts[parsed.Hostname()]
}
