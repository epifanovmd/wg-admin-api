// Package commands — исполнитель императивных команд бэкенда.
package commands

import (
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/shell"
	"wgadmin/agent/internal/update"
)

var ifaceName = regexp.MustCompile(`^[a-zA-Z0-9_=+.-]{1,15}$`)

// defaultTimeout — срок команды, если бэкенд его не передал.
const defaultTimeout = 60 * time.Second

// timeout — срок выполнения команды из timeoutSec.
func timeout(command protocol.Command) time.Duration {
	if command.TimeoutSec > 0 {
		return time.Duration(command.TimeoutSec) * time.Second
	}

	return defaultTimeout
}

// Backend — ответы бэкенду о командах: по каналу связи или по HTTP.
type Backend interface {
	AckCommand(id string) error
	CommandOutput(id, chunk string) error
	CompleteCommand(id string, exitCode *int, errMessage *string) error
	DownloadBinary(arch string, timeout time.Duration) (io.ReadCloser, error)
}

// Executor выполняет команды; дубликаты (команда повторяется в каждом
// состоянии, пока не принята) игнорируются.
type Executor struct {
	api       Backend
	configDir string
	paths     update.Paths
	// Restart — завершить процесс после обновления (supervisor запустит новый).
	Restart func()

	mu      sync.Mutex
	running map[string]bool
}

// New — исполнитель.
func New(client Backend, configDir string, paths update.Paths, restart func()) *Executor {
	return &Executor{api: client, configDir: configDir, paths: paths, Restart: restart, running: map[string]bool{}}
}

// Dispatch — запустить новые команды.
func (e *Executor) Dispatch(commands []protocol.Command) {
	for _, command := range commands {
		e.mu.Lock()
		if e.running[command.ID] {
			e.mu.Unlock()

			continue
		}
		e.running[command.ID] = true
		e.mu.Unlock()

		go func(command protocol.Command) {
			defer func() {
				e.mu.Lock()
				delete(e.running, command.ID)
				e.mu.Unlock()
			}()

			if err := e.execute(command); err != nil {
				logx.Error("Команда %s: %s", command.ID, err)
			}
		}(command)
	}
}

func ptr[T any](value T) *T { return &value }

func (e *Executor) execute(command protocol.Command) error {
	if err := e.api.AckCommand(command.ID); err != nil {
		return err
	}
	logx.Info("Команда %s (%s)", command.Type, command.ID)

	switch command.Type {
	case "interface-restart":
		return e.restart(command)
	case "agent-logs":
		return e.logs(command)
	case "agent-update":
		return e.update(command)
	default:
		return e.api.CompleteCommand(command.ID, nil, ptr("Неизвестный тип команды: "+command.Type))
	}
}

func (e *Executor) restart(command protocol.Command) error {
	name := command.Payload.InterfaceName
	if !ifaceName.MatchString(name) {
		return e.api.CompleteCommand(command.ID, nil, ptr("Некорректное имя интерфейса"))
	}

	// down и up укладываются в срок команды вместе.
	deadline := time.Now().Add(timeout(command))
	file := filepath.Join(e.configDir, name+".conf")
	down := shell.Run("wg-quick down "+file+" || true", time.Until(deadline))
	up := shell.Run("wg-quick up "+file, max(time.Until(deadline), time.Second))

	output := strings.TrimSpace(strings.Join([]string{down.Stderr, up.Stderr}, "\n"))
	if len(output) > 8000 {
		output = output[:8000]
	}
	if output != "" {
		_ = e.api.CommandOutput(command.ID, output)
	}

	var errMessage *string
	if up.Code != 0 {
		errMessage = ptr("wg-quick up завершился с ошибкой")
	}

	return e.api.CompleteCommand(command.ID, &up.Code, errMessage)
}

func (e *Executor) logs(command protocol.Command) error {
	lines := command.Payload.Lines
	if lines <= 0 {
		lines = 200
	}

	if err := e.api.CommandOutput(command.ID, logx.Tail(lines)); err != nil {
		return err
	}

	return e.api.CompleteCommand(command.ID, ptr(0), nil)
}

// update — бинарь своей архитектуры с бэкенда → проверка sha256 из команды
// → атомарная замена → выход. Supervisor запустит новую версию; не выйдет
// на связь трижды — откат на прежнюю.
func (e *Executor) update(command protocol.Command) error {
	fail := func(err error) error {
		return e.api.CompleteCommand(command.ID, nil, ptr(err.Error()))
	}

	if current, err := update.FileHash(e.paths.Binary); err == nil && current == command.Payload.Hash {
		_ = e.api.CommandOutput(command.ID, "Эта версия уже установлена")

		return e.api.CompleteCommand(command.ID, ptr(0), nil)
	}

	body, err := e.api.DownloadBinary(runtime.GOARCH, timeout(command))
	if err != nil {
		return fail(err)
	}
	defer body.Close()

	if err := update.Install(e.paths, body, command.Payload.Hash); err != nil {
		return fail(err)
	}

	_ = e.api.CommandOutput(command.ID, fmt.Sprintf("Версия %s… установлена, перезапуск агента", command.Payload.Hash[:12]))
	if err := e.api.CompleteCommand(command.ID, ptr(0), nil); err != nil {
		logx.Warn("Итог обновления: %s", err)
	}

	logx.Info("Обновление установлено — перезапуск")
	if e.Restart != nil {
		time.AfterFunc(500*time.Millisecond, e.Restart)
	}

	return nil
}
