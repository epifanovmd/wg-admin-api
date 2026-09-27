package link

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"wgadmin/agent/internal/api"
	"wgadmin/agent/internal/protocol"
)

// recorder — что агент получил от бэкенда.
type recorder struct {
	mu       sync.Mutex
	states   []protocol.DesiredState
	rates    []time.Duration
	contacts int
}

func (r *recorder) handler() Handler {
	return Handler{
		State: func(state protocol.DesiredState) {
			r.mu.Lock()
			r.states = append(r.states, state)
			r.mu.Unlock()
		},
		Rate: func(interval time.Duration) {
			r.mu.Lock()
			r.rates = append(r.rates, interval)
			r.mu.Unlock()
		},
		Contact: func() {
			r.mu.Lock()
			r.contacts++
			r.mu.Unlock()
		},
	}
}

func (r *recorder) snapshot() ([]protocol.DesiredState, []time.Duration, int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]protocol.DesiredState(nil), r.states...), append([]time.Duration(nil), r.rates...), r.contacts
}

func eventually(t *testing.T, what string, check func() bool) {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	for !check() {
		if time.Now().After(deadline) {
			t.Fatalf("не дождались: %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func newLink(t *testing.T, url string, transport Transport, events *recorder) *Link {
	t.Helper()

	l := New(Options{
		BackendURL: url,
		Key:        "node.key",
		Transport:  transport,
		Known:      func() int64 { return 4 },
		Handler:    events.handler(),
	}, api.New(url, "node.key", time.Second))
	go l.Run()
	t.Cleanup(l.Close)

	return l
}

// session — одно соединение агента на стороне тестового бэкенда.
type session struct {
	conn     *websocket.Conn
	incoming chan protocol.LinkMessage
}

func (s *session) send(t *testing.T, message protocol.LinkMessage) {
	t.Helper()

	data, _ := json.Marshal(message)
	if err := s.conn.Write(context.Background(), websocket.MessageText, data); err != nil {
		t.Errorf("запись агенту: %s", err)
	}
}

func (s *session) next(t *testing.T, kind string) protocol.LinkMessage {
	t.Helper()

	timeout := time.After(10 * time.Second)
	for {
		select {
		case message, ok := <-s.incoming:
			if !ok {
				t.Fatalf("соединение закрыто, ждали %s", kind)
			}
			if message.Type == kind {
				return message
			}
		case <-timeout:
			t.Fatalf("нет сообщения %s", kind)
		}
	}
}

// linkServer — бэкенд с каналом: каждое соединение уходит в sessions.
func linkServer(t *testing.T, sessions chan *session) *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != protocol.LinkPath || r.Header.Get("X-Api-Key") != "node.key" {
			http.Error(w, "unexpected", http.StatusUnauthorized)

			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}

		s := &session{conn: conn, incoming: make(chan protocol.LinkMessage, 64)}
		sessions <- s

		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				close(s.incoming)

				return
			}
			var message protocol.LinkMessage
			_ = json.Unmarshal(data, &message)
			s.incoming <- message
		}
	}))
	t.Cleanup(server.Close)

	return server
}

func accept(t *testing.T, sessions chan *session) *session {
	t.Helper()

	select {
	case s := <-sessions:
		return s
	case <-time.After(10 * time.Second):
		t.Fatal("агент не подключился")

		return nil
	}
}

func TestLinkHelloStateRateAndAck(t *testing.T) {
	sessions := make(chan *session, 4)
	server := linkServer(t, sessions)
	events := &recorder{}
	l := newLink(t, server.URL, TransportAuto, events)

	s := accept(t, sessions)
	hello := s.next(t, "hello")
	if hello.KnownVersion == nil || *hello.KnownVersion != 4 {
		t.Fatalf("hello без применённой версии: %+v", hello)
	}

	s.send(t, protocol.LinkMessage{Type: "welcome", Protocol: 1, StatsIntervalMs: 1000})
	eventually(t, "канал готов", func() bool { return l.Mode() == "ws" })

	s.send(t, protocol.LinkMessage{Type: "state", State: &protocol.DesiredState{Version: 5}})
	s.send(t, protocol.LinkMessage{Type: "rate", StatsIntervalMs: 10_000})
	eventually(t, "состояние и частота", func() bool {
		states, rates, contacts := events.snapshot()

		return len(states) == 1 && states[0].Version == 5 && len(rates) == 2 && contacts == 1
	})
	if _, rates, _ := events.snapshot(); rates[0] != time.Second || rates[1] != 10*time.Second {
		t.Fatalf("частоты: %v", rates)
	}

	l.PushStats(protocol.StatsBody{})
	stats := s.next(t, "stats").Stats
	if stats.Seq != 1 || stats.BootID == "" || stats.SentAt < stats.CollectedAt || stats.Interfaces == nil {
		t.Fatalf("тик: %+v", stats)
	}

	seq := stats.Seq
	s.send(t, protocol.LinkMessage{Type: "ack", AckSeq: &seq})
	eventually(t, "тик подтверждён", func() bool { return l.Pending() == 0 })

	// Ответы о командах и отчёт идут по каналу.
	if err := l.AckCommand("c1"); err != nil {
		t.Fatal(err)
	}
	if got := s.next(t, "command.ack"); got.ID != "c1" {
		t.Fatalf("command.ack: %+v", got)
	}
	if err := l.Report(protocol.Report{AgentVersion: "2.2.0"}); err != nil {
		t.Fatal(err)
	}
	if got := s.next(t, "report"); got.Report["agentVersion"] != "2.2.0" {
		t.Fatalf("report: %+v", got)
	}
}

func TestLinkResendsUnackedTicksAfterReconnect(t *testing.T) {
	sessions := make(chan *session, 4)
	server := linkServer(t, sessions)
	l := newLink(t, server.URL, TransportAuto, &recorder{})

	first := accept(t, sessions)
	first.next(t, "hello")
	first.send(t, protocol.LinkMessage{Type: "welcome", Protocol: 1})
	eventually(t, "канал готов", func() bool { return l.Mode() == "ws" })

	l.PushStats(protocol.StatsBody{})
	l.PushStats(protocol.StatsBody{})
	first.next(t, "stats")
	first.next(t, "stats")

	// Разрыв до подтверждения; пока связи нет — ещё тик в буфер.
	_ = first.conn.Close(websocket.StatusGoingAway, "restart")
	eventually(t, "разрыв замечен", func() bool { return l.Mode() == "" })
	l.PushStats(protocol.StatsBody{})

	second := accept(t, sessions)
	second.next(t, "hello")
	second.send(t, protocol.LinkMessage{Type: "welcome", Protocol: 1})

	for want := int64(1); want <= 3; want++ {
		if got := second.next(t, "stats").Stats.Seq; got != want {
			t.Fatalf("досылка не по порядку: тик %d, ожидался %d", got, want)
		}
	}

	l.PushStats(protocol.StatsBody{})
	if got := second.next(t, "stats").Stats.Seq; got != 4 {
		t.Fatalf("новый тик после досылки: %d", got)
	}
}

func TestLinkFallsBackToHTTPWhenUpgradeUnsupported(t *testing.T) {
	var (
		mu    sync.Mutex
		posts []protocol.StatsBody
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == protocol.LinkPath:
			http.NotFound(w, r)
		case r.URL.Path == "/api/v1/wg-agent/state" && r.Method == http.MethodGet:
			time.Sleep(50 * time.Millisecond)
			_ = json.NewEncoder(w).Encode(protocol.DesiredState{Version: 7, Settings: protocol.Settings{StatsIntervalMs: 2000}})
		case r.URL.Path == "/api/v1/wg-agent/stats":
			var body protocol.StatsBody
			data, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(data, &body)
			mu.Lock()
			posts = append(posts, body)
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	t.Cleanup(server.Close)

	events := &recorder{}
	l := newLink(t, server.URL, TransportAuto, events)

	eventually(t, "HTTP-режим и состояние", func() bool {
		states, rates, contacts := events.snapshot()

		return l.Mode() == "http" && len(states) > 0 && states[0].Version == 7 && rates[0] == 2*time.Second && contacts > 0
	})

	l.PushStats(protocol.StatsBody{})
	eventually(t, "тик по HTTP", func() bool {
		mu.Lock()
		defer mu.Unlock()

		return len(posts) == 1 && posts[0].Seq == 1 && l.Pending() == 0
	})
}

func TestFallbackStatus(t *testing.T) {
	for status, want := range map[int]bool{
		http.StatusOK:                 true,
		http.StatusBadRequest:         true,
		http.StatusNotFound:           true,
		http.StatusUpgradeRequired:    true,
		http.StatusUnauthorized:       false,
		http.StatusForbidden:          false,
		http.StatusTooManyRequests:    false,
		http.StatusBadGateway:         false,
		http.StatusServiceUnavailable: false,
	} {
		if got := fallbackStatus(status); got != want {
			t.Errorf("статус %d: переход на HTTP %v, ожидалось %v", status, got, want)
		}
	}
}
