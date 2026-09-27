// Package shell — запуск внешних утилит (wg, ip, iptables, conntrack, ping).
package shell

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Result — код возврата и вывод. Код 127 — бинарь не найден.
type Result struct {
	Code   int
	Stdout string
	Stderr string
}

// DefaultTimeout — таймаут команды по умолчанию.
const DefaultTimeout = 30 * time.Second

// Exec выполняет бинарь с аргументами (без shell-интерпретации).
func Exec(timeout time.Duration, name string, args ...string) Result {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)

	var stdout, stderr bytes.Buffer

	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	result := Result{Stdout: stdout.String(), Stderr: stderr.String()}

	var exitErr *exec.ExitError

	switch {
	case err == nil:
		result.Code = 0
	case errors.As(err, &exitErr):
		result.Code = exitErr.ExitCode()
		if result.Code < 0 {
			result.Code = 1
		}
	default:
		result.Code = 127
		if result.Stderr == "" {
			result.Stderr = err.Error()
		}
	}

	return result
}

// Run — `sh -c` для готовых команд (wg-quick, цепочки iptables).
func Run(command string, timeout time.Duration) Result {
	return Exec(timeout, "sh", "-c", command)
}

// Must — ошибка при ненулевом коде возврата.
func Must(timeout time.Duration, name string, args ...string) (Result, error) {
	result := Exec(timeout, name, args...)
	if result.Code != 0 {
		out := strings.TrimSpace(result.Stderr)
		if out == "" {
			out = strings.TrimSpace(result.Stdout)
		}

		return result, fmt.Errorf("%s %s → код %d: %s", name, strings.Join(args, " "), result.Code, truncate(out, 500))
	}

	return result, nil
}

// MustRun — `sh -c` с ошибкой при ненулевом коде.
func MustRun(command string, timeout time.Duration) error {
	result := Run(command, timeout)
	if result.Code != 0 {
		out := strings.TrimSpace(result.Stderr)
		if out == "" {
			out = strings.TrimSpace(result.Stdout)
		}

		return fmt.Errorf("%s → код %d: %s", command, result.Code, truncate(out, 500))
	}

	return nil
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}

	return value[:max]
}
