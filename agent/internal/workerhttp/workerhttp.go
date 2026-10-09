// Package workerhttp — общее для воркеров: HTTP на unix-сокете от агента,
// ответы JSON, чтение настроек и события агенту (POST /events на его сокете).
package workerhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"wgadmin/agent/internal/logx"
)

// maxBody — предел тела запроса: значение настройки у агента — до 4 МБ.
const maxBody = 8 << 20

// shutdownTimeout — сколько ждать запросы в работе при остановке: агент
// после SIGTERM ждёт stopTimeout (30 с), потом SIGKILL.
const shutdownTimeout = 20 * time.Second

// JSON — ответ с телом JSON.
func JSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// Error — ответ { message }.
func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, map[string]string{"message": message})
}

// NoContent — 204 без тела.
func NoContent(w http.ResponseWriter) { w.WriteHeader(http.StatusNoContent) }

// NotFound — 404 { message } на неизвестный путь.
func NotFound(w http.ResponseWriter, r *http.Request) {
	Error(w, http.StatusNotFound, fmt.Sprintf("нет маршрута %s %s", r.Method, r.URL.Path))
}

// ReadConfig — тело PUT /config/{key}: { version, data }, data — в target.
// Ошибка — текст для ответа 400.
func ReadConfig(r *http.Request, target any) (int64, error) {
	var body struct {
		Version int64           `json:"version"`
		Data    json.RawMessage `json:"data"`
	}

	raw, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxBody))
	if err != nil {
		return 0, fmt.Errorf("тело запроса: %w", err)
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return 0, fmt.Errorf("тело не JSON { version, data }: %w", err)
	}
	if len(body.Data) == 0 || string(body.Data) == "null" {
		return 0, errors.New("нет data")
	}
	if err := json.Unmarshal(body.Data, target); err != nil {
		return 0, fmt.Errorf("data: %w", err)
	}

	return body.Version, nil
}

// Listen — слушатель на unix-сокете path: прежний файл сокета удаляется.
func Listen(path string) (net.Listener, error) {
	if path == "" {
		return nil, errors.New("нет AGENT_WORKER_SOCKET: воркер запускает агент")
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	return net.Listen("unix", path)
}

// Serve — HTTP на сокете AGENT_WORKER_SOCKET до SIGTERM или SIGINT. После
// сигнала новые запросы не принимаются, начатые дорабатывают; созданное
// воркером на узле не убирается. stop — что сделать после остановки HTTP.
func Serve(handler http.Handler, stop func()) error {
	listener, err := Listen(os.Getenv("AGENT_WORKER_SOCKET"))
	if err != nil {
		return err
	}

	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer cancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		<-ctx.Done()
		logx.Info("Остановка: HTTP закрывается, созданное на узле остаётся")

		shutdown, cancelShutdown := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancelShutdown()
		_ = server.Shutdown(shutdown)
	}()

	if err := server.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-done
	if stop != nil {
		stop()
	}

	return nil
}

// Agent — клиент к сокету агента (AGENT_SOCKET) с токеном воркера.
type Agent struct {
	token  string
	client *http.Client
}

// NewAgent — клиент к сокету socket; пустой socket — события не отправляются.
func NewAgent(socket, token string) *Agent {
	if socket == "" {
		return &Agent{}
	}

	return &Agent{
		token: token,
		client: &http.Client{
			Timeout: 5 * time.Second,
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					return (&net.Dialer{}).DialContext(ctx, "unix", socket)
				},
			},
		},
	}
}

// AgentFromEnv — клиент по AGENT_SOCKET и AGENT_WORKER_TOKEN.
func AgentFromEnv() *Agent {
	return NewAgent(os.Getenv("AGENT_SOCKET"), os.Getenv("AGENT_WORKER_TOKEN"))
}

// Event — событие { type, data } агенту. Ошибка (агент перезапускается,
// outbox полон) — в журнал: событие не важнее работы воркера.
func (a *Agent) Event(typ string, data any) {
	if a == nil || a.client == nil {
		return
	}

	body, err := json.Marshal(map[string]any{"type": typ, "data": data})
	if err != nil {
		logx.Warn("Событие %s: %s", typ, err)

		return
	}

	req, _ := http.NewRequest(http.MethodPost, "http://agent/events", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("Content-Type", "application/json")

	res, err := a.client.Do(req)
	if err != nil {
		logx.Warn("Событие %s не отправлено: %s", typ, err)

		return
	}
	defer res.Body.Close()

	if res.StatusCode/100 != 2 {
		text, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		logx.Warn("Событие %s отклонено агентом: %d %s", typ, res.StatusCode, bytes.TrimSpace(text))
	}
}
