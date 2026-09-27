// Package logx — журнал агента: stdout (journald) и кольцевой буфер для
// команды `agent-logs`.
package logx

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

const ringMax = 2000

var (
	mu   sync.Mutex
	ring []string
)

func push(level, format string, args ...any) {
	line := fmt.Sprintf("%s [%s] %s", time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), level, fmt.Sprintf(format, args...))

	mu.Lock()
	ring = append(ring, line)
	if len(ring) > ringMax {
		ring = ring[len(ring)-ringMax:]
	}
	mu.Unlock()
	fmt.Fprintln(os.Stdout, line)
}

// Info — информационное сообщение.
func Info(format string, args ...any) { push("INFO", format, args...) }

// Warn — предупреждение.
func Warn(format string, args ...any) { push("WARN", format, args...) }

// Error — ошибка.
func Error(format string, args ...any) { push("ERROR", format, args...) }

// Tail — последние строки журнала.
func Tail(lines int) string {
	if lines < 1 {
		lines = 1
	}

	mu.Lock()
	defer mu.Unlock()

	start := len(ring) - lines
	if start < 0 {
		start = 0
	}

	return strings.Join(ring[start:], "\n")
}
