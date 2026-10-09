package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/workerhttp"
)

// fakeAgent — сокет агента: копит события воркера.
type fakeAgent struct {
	mu     sync.Mutex
	events []map[string]any
}

func (a *fakeAgent) list() []map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()

	return append([]map[string]any{}, a.events...)
}

func (a *fakeAgent) types() []string {
	var result []string
	for _, event := range a.list() {
		result = append(result, event["type"].(string))
	}

	return result
}

func startAgent(t *testing.T) (*fakeAgent, *workerhttp.Agent) {
	t.Helper()

	dir, err := os.MkdirTemp("", "wga")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })

	path := filepath.Join(dir, "agent.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}

	agent := &fakeAgent{}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/events" || r.Header.Get("Authorization") != "Bearer token" {
			w.WriteHeader(http.StatusUnauthorized)

			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		agent.mu.Lock()
		agent.events = append(agent.events, body)
		agent.mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })

	return agent, workerhttp.NewAgent(path, "token")
}

// faultySystem — имитация с подставными ошибками применения, медленным
// применением и пробами туннелей.
type faultySystem struct {
	*drySystem

	mu         sync.Mutex
	errors     []string
	delay      time.Duration
	tunnelLoss float64
}

func (s *faultySystem) set(patch func(*faultySystem)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	patch(s)
}

func (s *faultySystem) Apply(state desired.State, health *failover.Health) apply.Result {
	s.mu.Lock()
	errs, delay := append([]string{}, s.errors...), s.delay
	s.mu.Unlock()

	time.Sleep(delay)
	result := s.drySystem.Apply(state, health)
	result.Errors = append(result.Errors, errs...)

	return result
}

func (s *faultySystem) ProbeTunnels(tunnels []desired.Tunnel) []desired.TunnelProbe {
	s.mu.Lock()
	loss := s.tunnelLoss
	s.mu.Unlock()

	result := s.drySystem.ProbeTunnels(tunnels)
	for i := range result {
		result[i].LossPercent = loss
	}

	return result
}

type fixture struct {
	t       *testing.T
	sys     *faultySystem
	service *Service
	agent   *fakeAgent
	server  *httptest.Server
	dir     string
}

func setup(t *testing.T) *fixture {
	t.Helper()

	dir := t.TempDir()
	agent, client := startAgent(t)
	sys := &faultySystem{drySystem: newDrySystem(filepath.Join(dir, "wireguard"), filepath.Join(dir, "state"))}
	service := NewService(sys, client, "1.2.3", true)
	server := httptest.NewServer(service.Handler())
	t.Cleanup(server.Close)

	return &fixture{t: t, sys: sys, service: service, agent: agent, server: server, dir: dir}
}

func (f *fixture) call(method, path string, body any) (int, map[string]any) {
	f.t.Helper()

	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}

	req, _ := http.NewRequest(method, f.server.URL+path, reader)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		f.t.Fatal(err)
	}
	defer res.Body.Close()

	raw, _ := io.ReadAll(res.Body)
	var decoded map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &decoded); err != nil {
			f.t.Fatalf("%s %s: не JSON: %s", method, path, raw)
		}
	}

	return res.StatusCode, decoded
}

func ptr[T any](value T) *T { return &value }

func sampleState(version int64) desired.State {
	return desired.State{
		Version:  version,
		NodeID:   "node-1",
		NodeName: "relay",
		Interfaces: []desired.Interface{
			{
				Name: "wg0", Enabled: true, ListenPort: 51820, AddressCidr: "10.0.0.1/24", PrivateKey: "PRIV",
				Peers: []desired.Peer{{PublicKey: "PUB1", AllowedIPs: "10.0.0.2/32"}, {PublicKey: "PUB2", AllowedIPs: "10.0.0.3/32"}},
			},
			{Name: "wg1", Enabled: false, ListenPort: 51821, AddressCidr: "10.1.0.1/24", PrivateKey: "PRIV2", Peers: []desired.Peer{}},
		},
		Tunnels: []desired.Tunnel{{Name: "wgt1", RemoteHost: "203.0.113.20", LocalTunnelIP: "10.99.0.1", RemoteTunnelIP: "10.99.0.2", Prefix: 30, MTU: 1480}},
		Forwards: []desired.Forward{{
			ID: "f1", Proto: "udp", ListenPort: 51830, TargetIP: "10.99.0.2", TargetPort: 51820,
			Candidates: []desired.Candidate{
				{TargetIP: "10.99.0.2", Tunnel: ptr("wgt1"), NodeID: "node-2"},
				{TargetIP: "203.0.113.20", NodeID: "node-2"},
			},
		}},
	}
}

func config(state any) map[string]any { return map[string]any{"version": 5, "data": state} }

func TestManifest(t *testing.T) {
	f := setup(t)

	status, manifest := f.call("GET", "/manifest", nil)
	if status != 200 || manifest["version"] != "1.2.3" {
		t.Fatalf("%d %+v", status, manifest)
	}

	raw, _ := json.Marshal(manifest)
	if len(raw) > 64<<10 {
		t.Fatalf("манифест %d байт — больше 64 КБ", len(raw))
	}
	for _, want := range []string{`"key":"state"`, `"key":"probes"`, `"/interfaces/{name}/restart"`, `"path":"/state"`, `"state.result"`, `"route.changed"`} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("нет %s в манифесте", want)
		}
	}
}

func TestHealthBeforeAndAfterState(t *testing.T) {
	f := setup(t)

	status, health := f.call("GET", "/health", nil)
	info := health["info"].(map[string]any)
	if status != 200 || health["ok"] != true || info["dryRun"] != true || info["wgVersion"] != "dry-run" || info["wgMode"] != "userspace" || info["stateVersion"] != nil {
		t.Fatalf("%+v", health)
	}

	f.sys.set(func(s *faultySystem) { s.errors = []string{"wgt1: подсеть занята"} })
	f.call("PUT", "/config/state", config(sampleState(7)))

	_, health = f.call("GET", "/health", nil)
	info = health["info"].(map[string]any)
	if health["ok"] != true {
		t.Fatal("ошибки применения ok не роняют: иначе обновление воркера откатится")
	}
	if info["stateVersion"] != float64(7) || len(info["errors"].([]any)) != 1 || !strings.Contains(health["message"].(string), "подсеть занята") {
		t.Fatalf("%+v", health)
	}
}

func TestPutStateResult(t *testing.T) {
	f := setup(t)

	status, result := f.call("PUT", "/config/state", config(sampleState(7)))
	if status != 200 || result["version"] != float64(7) || result["appliedAt"] == nil {
		t.Fatalf("%d %+v", status, result)
	}

	interfaces := result["interfaces"].([]any)
	if interfaces[0].(map[string]any)["status"] != "up" || interfaces[1].(map[string]any)["status"] != "down" {
		t.Fatalf("%+v", interfaces)
	}
	route := result["routes"].([]any)[0].(map[string]any)
	if route["id"] != "f1" || route["activeRoute"] != "tunnel" || route["activeCandidate"] != float64(0) || route["activeNodeId"] != "node-2" {
		t.Fatalf("%+v", route)
	}
	if len(result["errors"].([]any)) != 0 {
		t.Fatalf("%+v", result)
	}

	conf, err := os.ReadFile(filepath.Join(f.dir, "wireguard", "wg0.conf"))
	if err != nil || !strings.Contains(string(conf), "PublicKey = PUB1") {
		t.Fatalf("конфиг для наглядности: %v %s", err, conf)
	}

	if status, last := f.call("GET", "/state", nil); status != 200 || last["version"] != float64(7) {
		t.Fatalf("%d %+v", status, last)
	}

	// Удалили wg1 — его конфиг удалён.
	next := sampleState(8)
	next.Interfaces = next.Interfaces[:1]
	f.call("PUT", "/config/state", config(next))
	if _, err := os.Stat(filepath.Join(f.dir, "wireguard", "wg1.conf")); !os.IsNotExist(err) {
		t.Fatal("конфиг удалённого интерфейса остался")
	}
}

func TestPutStateRejects(t *testing.T) {
	f := setup(t)

	for _, body := range []any{nil, map[string]any{"version": 1}, "строка"} {
		if status, answer := f.call("PUT", "/config/state", body); status != 400 || answer["message"] == nil {
			t.Fatalf("%v → %d %+v", body, status, answer)
		}
	}

	bad := sampleState(1)
	bad.Interfaces[0].Name = "wg0; rm -rf /"
	if status, answer := f.call("PUT", "/config/state", config(bad)); status != 422 || !strings.Contains(answer["message"].(string), "имя интерфейса") {
		t.Fatalf("%d %+v", status, answer)
	}
}

func TestForeignConfigIsKept(t *testing.T) {
	f := setup(t)

	foreign := []byte("[Interface]\nPrivateKey = CHUZHOY\n")
	_ = os.MkdirAll(filepath.Join(f.dir, "wireguard"), 0o700)
	_ = os.WriteFile(filepath.Join(f.dir, "wireguard", "wg0.conf"), foreign, 0o600)

	_, result := f.call("PUT", "/config/state", config(sampleState(1)))
	wg0 := result["interfaces"].([]any)[0].(map[string]any)
	if wg0["status"] != "error" || !strings.Contains(wg0["message"].(string), "чужой конфиг") {
		t.Fatalf("%+v", wg0)
	}
	if conf, _ := os.ReadFile(filepath.Join(f.dir, "wireguard", "wg0.conf")); !bytes.Equal(conf, foreign) {
		t.Fatal("чужой конфиг перезаписан")
	}
}

func TestRetryPublishesChangedResult(t *testing.T) {
	f := setup(t)

	f.sys.set(func(s *faultySystem) {
		s.errors = []string{"udp/51830 уже слушает другой процесс"}
	})
	f.call("PUT", "/config/state", config(sampleState(3)))

	// Тот же итог — событие не нужно: бэкенд его уже получил ответом.
	f.service.retryOnce()
	if len(f.agent.list()) != 0 {
		t.Fatalf("%+v", f.agent.list())
	}

	// Конфликт ушёл — итог изменился: событие state.result, повторы прекращаются.
	f.sys.set(func(s *faultySystem) { s.errors = nil })
	f.service.retryOnce()

	events := f.agent.list()
	if len(events) != 1 || events[0]["type"] != "state.result" {
		t.Fatalf("%+v", events)
	}
	data := events[0]["data"].(map[string]any)
	if data["version"] != float64(3) || len(data["errors"].([]any)) != 0 {
		t.Fatalf("%+v", data)
	}

	f.sys.set(func(s *faultySystem) { s.errors = []string{"не должно примениться"} })
	f.service.retryOnce()
	if len(f.agent.list()) != 1 {
		t.Fatal("без ошибок повторов нет")
	}
}

func TestRouteChangeReapplies(t *testing.T) {
	f := setup(t)
	f.call("PUT", "/config/state", config(sampleState(4)))

	f.sys.set(func(s *faultySystem) { s.tunnelLoss = 100 })
	for i := 0; i < failover.FailoverAfterFailures; i++ {
		f.service.probeOnce()
	}

	if got := strings.Join(f.agent.types(), ","); got != "route.changed,state.result" {
		t.Fatalf("события: %s", got)
	}
	changed := f.agent.list()[0]["data"].(map[string]any)
	route := changed["routes"].([]any)[0].(map[string]any)
	if changed["version"] != float64(4) || route["activeRoute"] != "direct" || route["activeCandidate"] != float64(1) {
		t.Fatalf("%+v", changed)
	}

	_, metrics := f.call("GET", "/metrics", nil)
	tunnel := metrics["tunnels"].([]any)[0].(map[string]any)
	if tunnel["name"] != "wgt1" || tunnel["lossPercent"] != float64(100) {
		t.Fatalf("%+v", metrics)
	}
	if metrics["forwards"].([]any)[0].(map[string]any)["activeRoute"] != "direct" {
		t.Fatalf("%+v", metrics)
	}
}

func TestSlowApplyAnswersLater(t *testing.T) {
	f := setup(t)
	f.service.timing.reply = 50 * time.Millisecond
	f.sys.set(func(s *faultySystem) { s.delay = 300 * time.Millisecond })

	status, result := f.call("PUT", "/config/state", config(sampleState(9)))
	if status != 202 || result["version"] != float64(9) {
		t.Fatalf("%d %+v", status, result)
	}

	deadline := time.Now().Add(3 * time.Second)
	for len(f.agent.list()) == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	events := f.agent.list()
	if len(events) != 1 || events[0]["type"] != "state.result" || events[0]["data"].(map[string]any)["version"] != float64(9) {
		t.Fatalf("итог долгого применения — событием: %+v", events)
	}
}

func TestRestart(t *testing.T) {
	f := setup(t)

	if status, _ := f.call("POST", "/interfaces/wg0/restart", nil); status != 404 {
		t.Fatalf("до настройки интерфейса нет: %d", status)
	}

	f.call("PUT", "/config/state", config(sampleState(1)))

	if status, answer := f.call("POST", "/interfaces/wg0/restart", nil); status != 200 || answer["name"] != "wg0" || answer["status"] != "up" {
		t.Fatalf("%d %+v", status, answer)
	}
	if status, _ := f.call("POST", "/interfaces/wg1/restart", nil); status != 409 {
		t.Fatalf("выключенный: %d", status)
	}
	if status, answer := f.call("POST", "/interfaces/wg9/restart", nil); status != 404 || answer["message"] == nil {
		t.Fatalf("%d %+v", status, answer)
	}
}

func TestMetrics(t *testing.T) {
	f := setup(t)

	_, empty := f.call("GET", "/metrics", nil)
	for _, key := range []string{"interfaces", "tunnels", "forwards", "nodeProbes"} {
		if list, ok := empty[key].([]any); !ok || len(list) != 0 {
			t.Fatalf("%s: %+v", key, empty)
		}
	}

	f.call("PUT", "/config/state", config(sampleState(1)))
	f.call("PUT", "/config/probes", map[string]any{"version": 1, "data": map[string]any{"targets": []any{map[string]any{"nodeId": "node-2", "host": "203.0.113.20"}}}})
	f.service.probeOnce()
	f.service.probeNodesOnce()

	_, metrics := f.call("GET", "/metrics", nil)
	interfaces := metrics["interfaces"].([]any)
	if len(interfaces) != 1 {
		t.Fatalf("только включённые интерфейсы: %+v", interfaces)
	}
	peer := interfaces[0].(map[string]any)["peers"].([]any)[1].(map[string]any)
	if peer["publicKey"] != "PUB2" || peer["endpoint"] != "203.0.113.2:51820" || peer["lastHandshake"] == nil || peer["rxBytes"].(float64) <= 0 {
		t.Fatalf("%+v", peer)
	}

	node := metrics["nodeProbes"].([]any)[0].(map[string]any)
	if node["nodeId"] != "node-2" || node["lossPercent"] != float64(0) || node["rttMs"].(float64) < 1 || node["rttMs"].(float64) > 5 {
		t.Fatalf("%+v", node)
	}
	tunnel := metrics["tunnels"].([]any)[0].(map[string]any)
	if tunnel["mtuOk"] != true {
		t.Fatalf("%+v", tunnel)
	}

	if status, _ := f.call("DELETE", "/config/probes", nil); status != 204 {
		t.Fatal(status)
	}
	_, metrics = f.call("GET", "/metrics", nil)
	if len(metrics["nodeProbes"].([]any)) != 0 {
		t.Fatalf("%+v", metrics)
	}
}

func TestDeleteStateAndCleanup(t *testing.T) {
	f := setup(t)
	confDir := filepath.Join(f.dir, "wireguard")
	stateFile := filepath.Join(f.dir, "state", "state.json")

	f.call("PUT", "/config/state", config(sampleState(1)))
	if status, _ := f.call("DELETE", "/config/state", nil); status != 204 {
		t.Fatal(status)
	}
	if _, err := os.Stat(filepath.Join(confDir, "wg0.conf")); !os.IsNotExist(err) {
		t.Fatal("DELETE снимает интерфейсы воркера")
	}
	if status, _ := f.call("GET", "/state", nil); status != 404 {
		t.Fatal("итог забыт")
	}

	f.call("PUT", "/config/state", config(sampleState(2)))
	if status, _ := f.call("POST", "/cleanup", nil); status != 204 {
		t.Fatal(status)
	}
	if _, err := os.Stat(stateFile); !os.IsNotExist(err) {
		t.Fatal("cleanup удаляет файл состояния")
	}
	if _, err := os.Stat(filepath.Join(confDir, "wg0.conf")); !os.IsNotExist(err) {
		t.Fatal("cleanup удаляет конфиги")
	}

	// После уборки — ни повторов, ни переприменения по пробам.
	f.sys.set(func(s *faultySystem) { s.errors = []string{"x"}; s.tunnelLoss = 100 })
	for i := 0; i < 4; i++ {
		f.service.retryOnce()
		f.service.probeOnce()
	}
	if _, err := os.Stat(stateFile); !os.IsNotExist(err) {
		t.Fatal("после уборки воркер ничего не применяет")
	}
	if len(f.agent.list()) != 0 {
		t.Fatalf("%+v", f.agent.list())
	}
}

func TestUnknownPath(t *testing.T) {
	f := setup(t)

	if status, answer := f.call("GET", "/nope", nil); status != 404 || answer["message"] == nil {
		t.Fatalf("%d %+v", status, answer)
	}
}
