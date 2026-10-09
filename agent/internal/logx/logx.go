// Package logx — журнал воркера: построчно, info — в stdout, предупреждения и
// ошибки — в stderr. Агент читает оба потока (stdout — уровень info, stderr —
// warn) и сам ставит время записи.
package logx

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
)

var (
	mu     sync.Mutex
	stdout io.Writer = os.Stdout
	stderr io.Writer = os.Stderr
)

func write(out io.Writer, level, format string, args ...any) {
	// Одна запись — одна строка: агент читает вывод построчно.
	line := strings.ReplaceAll(fmt.Sprintf(format, args...), "\n", " ")

	mu.Lock()
	defer mu.Unlock()

	if level == "" {
		fmt.Fprintln(out, line)

		return
	}
	fmt.Fprintf(out, "%s %s\n", level, line)
}

// Info — информационное сообщение.
func Info(format string, args ...any) { write(stdout, "", format, args...) }

// Warn — предупреждение.
func Warn(format string, args ...any) { write(stderr, "WARN", format, args...) }

// Error — ошибка.
func Error(format string, args ...any) { write(stderr, "ERROR", format, args...) }
