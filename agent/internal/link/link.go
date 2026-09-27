// Package link — связь агента с бэкендом. Основной канал — постоянное
// WebSocket-соединение: состояние и команды приходят сразу при изменении,
// тики статистики подтверждаются номером и досылаются после разрыва, частота
// статистики задаётся бэкендом по спросу. Запасной путь — HTTP-протокол
// (long-poll состояния и POST), если сервер или прокси не пропускают
// WebSocket либо так задано конфигурацией.
package link

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"wgadmin/agent/internal/api"
	"wgadmin/agent/internal/backoff"
	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/protocol"
)

const (
	// BufferSize — сколько неподтверждённых тиков хранится для досылки.
	BufferSize = 600
	// Предел сообщения бэкенда: состояние с ключами и пирами всех интерфейсов.
	readLimit = 16 << 20
	// Не дольше — установка соединения, запись сообщения, ответ на ping.
	dialTimeout  = 15 * time.Second
	writeTimeout = 10 * time.Second
	pingTimeout  = 10 * time.Second
	// Сколько ждать welcome после hello.
	welcomeTimeout = 15 * time.Second
	// Сколько тиков досылается по HTTP за один раз.
	httpFlushBatch = 60
	// Код закрытия бэкенда при отзыве ключа.
	closeUnauthorized = 4401
)

// Transport — способ связи с бэкендом.
type Transport string

const (
	// TransportAuto — WebSocket, HTTP при неподдержке канала сервером.
	TransportAuto Transport = "auto"
	// TransportHTTP — только HTTP-протокол.
	TransportHTTP Transport = "http"
)

// Handler — реакции агента на сообщения бэкенда. Вызываются из горутины
// чтения: не блокировать надолго.
type Handler struct {
	// State — новое желаемое состояние (изменение конфигурации или команды).
	State func(protocol.DesiredState)
	// Rate — частота статистики, которую просит бэкенд.
	Rate func(time.Duration)
	// Contact — бэкенд ответил (для отметки «обновление вышло на связь»).
	Contact func()
}

// Options — параметры канала.
type Options struct {
	BackendURL string
	Key        string
	Transport  Transport
	// Known — версия конфигурации, применённая агентом.
	Known func() int64
	// PingEvery — период проверки живости соединения.
	PingEvery time.Duration
	// FallbackFor — сколько работать по HTTP, прежде чем снова пробовать канал.
	FallbackFor time.Duration
	Handler     Handler
}

// Link — связь с бэкендом.
type Link struct {
	opts   Options
	api    *api.Client
	buffer *Buffer
	ctx    context.Context
	cancel context.CancelFunc

	// sendMu — порядок тиков: досылка буфера и новые тики не перемешиваются.
	sendMu sync.Mutex
	mu     sync.Mutex
	conn   *websocket.Conn
	ready  bool
	mode   string
}

// New — канал к бэкенду; HTTP-клиент — запасной путь и скачивание бинаря.
func New(opts Options, client *api.Client) *Link {
	if opts.PingEvery <= 0 {
		opts.PingEvery = 20 * time.Second
	}
	if opts.FallbackFor <= 0 {
		opts.FallbackFor = 10 * time.Minute
	}
	ctx, cancel := context.WithCancel(context.Background())

	return &Link{opts: opts, api: client, buffer: NewBuffer(BufferSize), ctx: ctx, cancel: cancel}
}

// Mode — текущий способ связи: "ws", "http" или "" (нет связи).
func (l *Link) Mode() string {
	l.mu.Lock()
	defer l.mu.Unlock()

	return l.mode
}

// Pending — сколько тиков ждут подтверждения.
func (l *Link) Pending() int { return l.buffer.Len() }

// Close — закрыть канал (остановка агента).
func (l *Link) Close() {
	l.cancel()

	l.mu.Lock()
	conn := l.conn
	l.mu.Unlock()

	if conn != nil {
		_ = conn.Close(websocket.StatusNormalClosure, "agent stopping")
	}
}

// Run — поддерживать связь до Close.
func (l *Link) Run() {
	failures := 0

	for l.ctx.Err() == nil {
		if l.opts.Transport == TransportHTTP {
			l.runHTTP(time.Time{})

			continue
		}

		contacted, err := l.runWS()
		if l.ctx.Err() != nil {
			return
		}
		if contacted {
			failures = 0
		}

		var unsupported *unsupportedError
		if errors.As(err, &unsupported) {
			logx.Warn("Канал связи недоступен (%s) — HTTP-протокол на %s", unsupported, l.opts.FallbackFor)
			l.runHTTP(time.Now().Add(l.opts.FallbackFor))

			continue
		}

		delay := backoff.Delay(failures, nil)
		failures++
		logx.Warn("Канал связи: %s — переподключение через %d с", err, int(delay.Seconds()))
		l.sleep(delay)
	}
}

func (l *Link) sleep(delay time.Duration) {
	select {
	case <-l.ctx.Done():
	case <-time.After(delay):
	}
}

func (l *Link) setMode(mode string) {
	l.mu.Lock()
	l.mode = mode
	l.mu.Unlock()
}

// unsupportedError — сервер или прокси ответили на upgrade без канала:
// работаем по HTTP.
type unsupportedError struct{ status int }

func (e *unsupportedError) Error() string { return "HTTP " + strconv.Itoa(e.status) }

// linkURL — адрес канала: http(s) → ws(s).
func (l *Link) linkURL() string {
	base := l.opts.BackendURL
	switch {
	case strings.HasPrefix(base, "https://"):
		base = "wss://" + strings.TrimPrefix(base, "https://")
	case strings.HasPrefix(base, "http://"):
		base = "ws://" + strings.TrimPrefix(base, "http://")
	}

	return base + protocol.LinkPath
}

// runWS — одна сессия канала: подключение, hello, чтение до разрыва.
// contacted — бэкенд успел ответить welcome.
func (l *Link) runWS() (contacted bool, err error) {
	dialCtx, cancel := context.WithTimeout(l.ctx, dialTimeout)
	header := http.Header{}
	header.Set("X-Api-Key", l.opts.Key)
	header.Set("X-Agent-Link", strconv.Itoa(protocol.LinkProtocol))

	conn, resp, err := websocket.Dial(dialCtx, l.linkURL(), &websocket.DialOptions{HTTPHeader: header})
	cancel()
	if resp != nil && resp.Body != nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		_ = resp.Body.Close()
	}
	if err != nil {
		if resp != nil && fallbackStatus(resp.StatusCode) {
			return false, &unsupportedError{status: resp.StatusCode}
		}

		return false, err
	}
	conn.SetReadLimit(readLimit)

	l.mu.Lock()
	l.conn = conn
	l.mu.Unlock()

	defer func() {
		l.sendMu.Lock()
		l.mu.Lock()
		l.conn = nil
		l.ready = false
		l.mode = ""
		l.mu.Unlock()
		l.sendMu.Unlock()
		_ = conn.CloseNow()
	}()

	known := l.opts.Known()
	if err := l.write(conn, protocol.LinkMessage{Type: "hello", KnownVersion: &known}); err != nil {
		return false, err
	}

	sessionCtx, stop := context.WithCancel(l.ctx)
	defer stop()
	go l.keepAlive(sessionCtx, conn)

	welcomed := make(chan struct{})
	go func() {
		select {
		case <-welcomed:
		case <-sessionCtx.Done():
		case <-time.After(welcomeTimeout):
			_ = conn.Close(websocket.StatusPolicyViolation, "no welcome")
		}
	}()

	for {
		_, data, err := conn.Read(sessionCtx)
		if err != nil {
			if websocket.CloseStatus(err) == closeUnauthorized {
				return contacted, errors.New("ключ агента отозван или заменён")
			}

			return contacted, err
		}

		var message protocol.LinkMessage
		if err := json.Unmarshal(data, &message); err != nil {
			logx.Warn("Канал связи: неразборчивое сообщение: %s", err)

			continue
		}

		if message.Type == "welcome" && !contacted {
			contacted = true
			close(welcomed)
			l.onWelcome(conn, message)

			continue
		}
		l.handle(message)
	}
}

// fallbackStatus — ответ без upgrade, при котором канал не заработает и
// повтором: сервер без канала, прокси без WebSocket. Ошибки ключа, лимиты и
// 5xx — повод переподключаться, а не менять протокол.
func fallbackStatus(status int) bool {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusTooManyRequests:
		return false
	}

	return status < 500 && status != http.StatusSwitchingProtocols
}

func (l *Link) onWelcome(conn *websocket.Conn, message protocol.LinkMessage) {
	logx.Info("Канал связи с бэкендом установлен")
	l.contact()
	if message.StatsIntervalMs > 0 && l.opts.Handler.Rate != nil {
		l.opts.Handler.Rate(time.Duration(message.StatsIntervalMs) * time.Millisecond)
	}

	// Досылка неподтверждённых тиков — до новых, под тем же замком.
	l.sendMu.Lock()
	defer l.sendMu.Unlock()

	for _, body := range l.buffer.Pending() {
		if err := l.sendStats(conn, body); err != nil {
			return
		}
	}

	l.mu.Lock()
	l.ready = true
	l.mode = "ws"
	l.mu.Unlock()
}

func (l *Link) handle(message protocol.LinkMessage) {
	switch message.Type {
	case "state":
		if message.State != nil && l.opts.Handler.State != nil {
			l.opts.Handler.State(*message.State)
		}
	case "rate":
		if message.StatsIntervalMs > 0 && l.opts.Handler.Rate != nil {
			l.opts.Handler.Rate(time.Duration(message.StatsIntervalMs) * time.Millisecond)
		}
	case "ack":
		if message.AckSeq != nil {
			l.buffer.Ack(*message.AckSeq)
		}
	case "error":
		logx.Warn("Бэкенд отклонил сообщение: %s", message.Message)
	}
}

func (l *Link) contact() {
	if l.opts.Handler.Contact != nil {
		l.opts.Handler.Contact()
	}
}

// keepAlive — ping по таймеру: мёртвое соединение (NAT, обрыв без FIN)
// закрывается, и цикл переподключается.
func (l *Link) keepAlive(ctx context.Context, conn *websocket.Conn) {
	ticker := time.NewTicker(l.opts.PingEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil && ctx.Err() == nil {
				logx.Warn("Канал связи: нет ответа на ping — переподключение")
				_ = conn.CloseNow()

				return
			}
		}
	}
}

func (l *Link) write(conn *websocket.Conn, message protocol.LinkMessage) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(l.ctx, writeTimeout)
	defer cancel()

	return conn.Write(ctx, websocket.MessageText, data)
}

func (l *Link) sendStats(conn *websocket.Conn, body protocol.StatsBody) error {
	body.SentAt = time.Now().UnixMilli()
	if body.Interfaces == nil {
		body.Interfaces = []protocol.InterfaceStats{}
	}

	return l.write(conn, protocol.LinkMessage{Type: "stats", Stats: &body})
}

// readyConn — соединение, готовое к отправке, или nil.
func (l *Link) readyConn() *websocket.Conn {
	l.mu.Lock()
	defer l.mu.Unlock()

	if !l.ready {
		return nil
	}

	return l.conn
}

// PushStats — тик статистики: номер, буфер, отправка по каналу или HTTP.
// Без связи тик ждёт в буфере досылки.
func (l *Link) PushStats(body protocol.StatsBody) {
	l.sendMu.Lock()
	defer l.sendMu.Unlock()

	body = l.buffer.Add(body)

	if conn := l.readyConn(); conn != nil {
		if err := l.sendStats(conn, body); err != nil {
			logx.Warn("Статистика по каналу: %s", err)
		}

		return
	}
	if l.Mode() == "http" {
		l.flushHTTP()
	}
}

// flushHTTP — неподтверждённые тики по HTTP по порядку; успешный POST —
// подтверждение.
func (l *Link) flushHTTP() {
	pending := l.buffer.Pending()
	if len(pending) > httpFlushBatch {
		pending = pending[:httpFlushBatch]
	}

	for _, body := range pending {
		body.SentAt = time.Now().UnixMilli()
		if err := l.api.Stats(body); err != nil {
			logx.Warn("Статистика: %s", err)

			return
		}
		l.buffer.Ack(body.Seq)
	}
}

// runHTTP — запасной путь: long-poll состояния до until (нулевое — всегда).
func (l *Link) runHTTP(until time.Time) {
	l.setMode("http")
	defer l.setMode("")

	failures := 0
	delivered := l.opts.Known()

	for l.ctx.Err() == nil && (until.IsZero() || time.Now().Before(until)) {
		if applied := l.opts.Known(); applied > delivered {
			delivered = applied
		}

		desired, err := l.api.FetchState(delivered)
		if err != nil {
			delay := backoff.Delay(failures, nil)
			failures++
			logx.Error("Состояние по HTTP: %s — повтор через %d с", err, int(delay.Seconds()))
			l.sleep(delay)

			continue
		}
		failures = 0
		delivered = desired.Version

		l.contact()
		if desired.Settings.StatsIntervalMs > 0 && l.opts.Handler.Rate != nil {
			l.opts.Handler.Rate(time.Duration(desired.Settings.StatsIntervalMs) * time.Millisecond)
		}
		if l.opts.Handler.State != nil {
			l.opts.Handler.State(desired)
		}
	}
}

// send — сообщение по каналу; false — канала нет или запись не удалась.
func (l *Link) send(message protocol.LinkMessage) bool {
	conn := l.readyConn()
	if conn == nil {
		return false
	}
	if err := l.write(conn, message); err != nil {
		logx.Warn("Канал связи (%s): %s — отправляю по HTTP", message.Type, err)

		return false
	}

	return true
}

// Report — отчёт о применении.
func (l *Link) Report(report protocol.Report) error {
	body := report.Body()
	if l.send(protocol.LinkMessage{Type: "report", Report: body}) {
		return nil
	}

	return l.api.Report(report)
}

// AckCommand — команда принята.
func (l *Link) AckCommand(id string) error {
	if l.send(protocol.LinkMessage{Type: "command.ack", ID: id}) {
		return nil
	}

	return l.api.AckCommand(id)
}

// CommandOutput — порция вывода команды.
func (l *Link) CommandOutput(id, chunk string) error {
	if l.send(protocol.LinkMessage{Type: "command.output", ID: id, Chunk: &chunk}) {
		return nil
	}

	return l.api.CommandOutput(id, chunk)
}

// CompleteCommand — итог команды.
func (l *Link) CompleteCommand(id string, exitCode *int, errMessage *string) error {
	if l.send(protocol.LinkMessage{Type: "command.complete", ID: id, ExitCode: exitCode, Error: errMessage}) {
		return nil
	}

	return l.api.CompleteCommand(id, exitCode, errMessage)
}

// DownloadBinary — бинарь агента (только HTTP).
func (l *Link) DownloadBinary(arch string, timeout time.Duration) (io.ReadCloser, error) {
	return l.api.DownloadBinary(arch, timeout)
}
