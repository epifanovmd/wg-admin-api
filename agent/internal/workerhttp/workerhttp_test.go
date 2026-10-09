package workerhttp

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// shortDir — каталог для unix-сокета: путь сокета ограничен ~100 символами.
func shortDir(t *testing.T) string {
	t.Helper()

	dir, err := os.MkdirTemp("", "wh")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })

	return dir
}

func TestReadConfig(t *testing.T) {
	var data struct {
		Name string `json:"name"`
	}

	version, err := ReadConfig(httptest.NewRequest("PUT", "/config/x", strings.NewReader(`{"version":7,"data":{"name":"a"}}`)), &data)
	if err != nil || version != 7 || data.Name != "a" {
		t.Fatalf("%d %+v %v", version, data, err)
	}

	for _, body := range []string{`{`, `{"version":1}`, `{"version":1,"data":null}`, `{"version":1,"data":[1]}`} {
		if _, err := ReadConfig(httptest.NewRequest("PUT", "/config/x", strings.NewReader(body)), &data); err == nil {
			t.Fatalf("%s — ошибка", body)
		}
	}
}

func TestListenReplacesStaleSocket(t *testing.T) {
	path := filepath.Join(shortDir(t), "w.sock")
	_ = os.WriteFile(path, nil, 0o600)

	listener, err := Listen(path)
	if err != nil {
		t.Fatal(err)
	}
	_ = listener.Close()

	if _, err := Listen(""); err == nil {
		t.Fatal("без AGENT_WORKER_SOCKET — ошибка")
	}
}

func TestEvent(t *testing.T) {
	path := filepath.Join(shortDir(t), "a.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}

	received := make(chan map[string]any, 1)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/events" || r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(http.StatusUnauthorized)

			return
		}
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		received <- body
		w.WriteHeader(http.StatusAccepted)
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })

	NewAgent(path, "secret").Event("state.result", map[string]int{"version": 3})

	body := <-received
	if body["type"] != "state.result" || body["data"].(map[string]any)["version"] != float64(3) {
		t.Fatalf("%+v", body)
	}

	// Агента нет — без паники и без ожидания.
	NewAgent(filepath.Join(shortDir(t), "none.sock"), "x").Event("state.result", nil)
	NewAgent("", "").Event("state.result", nil)
}
