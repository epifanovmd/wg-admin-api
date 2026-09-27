package commands

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"wgadmin/agent/internal/api"
	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/update"
)

// Произвольные команды на ноде не выполняются: тип `shell` — «неизвестный
// тип», без вывода.
func TestShellCommandIsRejected(t *testing.T) {
	var (
		mu       sync.Mutex
		complete map[string]any
		paths    []string
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)

		mu.Lock()
		paths = append(paths, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/complete") {
			_ = json.Unmarshal(body, &complete)
		}
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	marker := filepath.Join(t.TempDir(), "executed")
	executor := New(api.New(server.URL, "key", time.Second), t.TempDir(), updatePaths(t), func() {})

	var raw protocol.Command
	payload := `{"id":"c1","type":"shell","timeoutSec":5,"payload":{"command":"touch ` + marker + `"}}`
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		t.Fatal(err)
	}

	if err := executor.execute(raw); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(marker); err == nil {
		t.Fatal("shell-команда выполнена")
	}
	mu.Lock()
	defer mu.Unlock()
	if complete == nil || !strings.Contains(complete["error"].(string), "Неизвестный тип") {
		t.Fatalf("команда не завершена ошибкой: %v (запросы %v)", complete, paths)
	}
	for _, path := range paths {
		if strings.HasSuffix(path, "/output") {
			t.Fatal("отправлен вывод команды")
		}
	}
}

func TestCommandTimeout(t *testing.T) {
	if got := timeout(protocol.Command{TimeoutSec: 5}); got != 5*time.Second {
		t.Fatalf("timeoutSec=5: %s", got)
	}
	if got := timeout(protocol.Command{}); got != defaultTimeout {
		t.Fatalf("без timeoutSec: %s", got)
	}
}

func updatePaths(t *testing.T) update.Paths {
	dir := t.TempDir()

	return update.Paths{Binary: filepath.Join(dir, "agent"), Marker: filepath.Join(dir, ".agent-update")}
}
