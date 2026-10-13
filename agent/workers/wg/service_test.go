package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/epifanovmd/agent/protocol"
	"github.com/epifanovmd/agent/worker"

	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/contract"
	"wgadmin/agent/internal/failover"
)

// recorder — агент для теста: копит события воркера; down — агент их не принимает.
type recorder struct {
	mu     sync.Mutex
	down   bool
	events []recorded
}

type recorded struct {
	typ  string
	data map[string]any
}

func (r *recorder) Emit(_ context.Context, typ string, data any) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.down {
		return errors.New("агент не на связи")
	}
	raw, _ := json.Marshal(data)
	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	r.events = append(r.events, recorded{typ: typ, data: decoded})

	return nil
}

func (r *recorder) list() []recorded {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]recorded{}, r.events...)
}

func (r *recorder) types() []string {
	var result []string
	for _, event := range r.list() {
		result = append(result, event.typ)
	}

	return result
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

func (s *faultySystem) Apply(state contract.State, health *failover.Health) apply.Result {
	s.mu.Lock()
	errs, delay := append([]string{}, s.errors...), s.delay
	s.mu.Unlock()

	time.Sleep(delay)
	result := s.drySystem.Apply(state, health)
	result.Errors = append(result.Errors, errs...)

	return result
}

func (s *faultySystem) ProbeTunnels(tunnels []contract.Tunnel) []contract.TunnelProbe {
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
	agent   *recorder
	dir     string
}

func setup(t *testing.T) *fixture {
	t.Helper()

	dir := t.TempDir()
	agent := &recorder{}
	sys := &faultySystem{drySystem: newDrySystem(filepath.Join(dir, "wireguard"), filepath.Join(dir, "state"))}
	service := NewService(sys)
	service.SetEvents(agent)

	return &fixture{t: t, sys: sys, service: service, agent: agent, dir: dir}
}

// configure — ключ настроек как от агента.
func (f *fixture) configure(key string, value any) error {
	f.t.Helper()

	var data json.RawMessage
	if value != nil {
		data, _ = json.Marshal(value)
	}

	return f.service.Configure(context.Background(), key, data)
}

// last — данные последнего события typ.
func (f *fixture) last(typ string) map[string]any {
	f.t.Helper()

	events := f.agent.list()
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].typ == typ {
			return events[i].data
		}
	}
	f.t.Fatalf("нет события %s: %v", typ, f.agent.types())

	return nil
}

func (f *fixture) metrics() map[string]any {
	f.t.Helper()

	var metrics map[string]any
	if err := json.Unmarshal(f.service.Health().Metrics, &metrics); err != nil {
		f.t.Fatal(err)
	}

	return metrics
}

func code(err error) string {
	var info *protocol.ErrorInfo
	if errors.As(err, &info) {
		return info.Code
	}

	return ""
}

func ptr[T any](value T) *T { return &value }

func sampleState(version int64) contract.State {
	return contract.State{
		Version:  version,
		NodeID:   "node-1",
		NodeName: "relay",
		Interfaces: []contract.Interface{
			{
				Name: "wg0", Enabled: true, ListenPort: 51820, AddressCidr: "10.0.0.1/24", PrivateKey: "PRIV",
				Peers: []contract.Peer{{PublicKey: "PUB1", AllowedIPs: "10.0.0.2/32"}, {PublicKey: "PUB2", AllowedIPs: "10.0.0.3/32"}},
			},
			{Name: "wg1", Enabled: false, ListenPort: 51821, AddressCidr: "10.1.0.1/24", PrivateKey: "PRIV2", Peers: []contract.Peer{}},
		},
		Tunnels: []contract.Tunnel{{Name: "wgt1", RemoteHost: "203.0.113.20", LocalTunnelIP: "10.99.0.1", RemoteTunnelIP: "10.99.0.2", Prefix: 30, MTU: 1480}},
		Forwards: []contract.Forward{{
			ID: "f1", Proto: "udp", ListenPort: 51830, TargetIP: "10.99.0.2", TargetPort: 51820,
			Candidates: []contract.Candidate{
				{TargetIP: "10.99.0.2", Tunnel: ptr("wgt1"), NodeID: "node-2"},
				{TargetIP: "203.0.113.20", NodeID: "node-2"},
			},
		}},
	}
}

func TestManifest(t *testing.T) {
	manifest := Manifest()
	if err := (&protocol.Register{Version: "1.2.3", Manifest: manifest}).Check(); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(manifest)
	if len(raw) > 64<<10 {
		t.Fatalf("манифест %d байт — больше 64 КБ", len(raw))
	}
	if !manifest.DeclaresConfig(ConfigState) || !manifest.DeclaresConfig(ConfigProbes) || !manifest.DeclaresCommand(CommandRestart) {
		t.Fatalf("%s", raw)
	}
	for _, typ := range []string{EventStateResult, EventRouteChanged, EventNodeInfo} {
		if !strings.Contains(string(raw), `"type":"`+typ+`"`) {
			t.Fatalf("нет события %s", typ)
		}
	}
}

func TestStateResult(t *testing.T) {
	f := setup(t)

	if err := f.configure(ConfigState, sampleState(7)); err != nil {
		t.Fatal(err)
	}
	result := f.last(EventStateResult)
	if result["version"] != float64(7) || result["appliedAt"] == nil || len(result["errors"].([]any)) != 0 {
		t.Fatalf("%+v", result)
	}
	interfaces := result["interfaces"].([]any)
	if interfaces[0].(map[string]any)["status"] != "up" || interfaces[1].(map[string]any)["status"] != "down" {
		t.Fatalf("%+v", interfaces)
	}
	route := result["routes"].([]any)[0].(map[string]any)
	if route["id"] != "f1" || route["activeRoute"] != "tunnel" || route["activeCandidate"] != float64(0) || route["activeNodeId"] != "node-2" {
		t.Fatalf("%+v", route)
	}

	conf, err := os.ReadFile(filepath.Join(f.dir, "wireguard", "wg0.conf"))
	if err != nil || !strings.Contains(string(conf), "PublicKey = PUB1") {
		t.Fatalf("конфиг для наглядности: %v %s", err, conf)
	}

	// Удалили wg1 — его конфиг удалён.
	next := sampleState(8)
	next.Interfaces = next.Interfaces[:1]
	_ = f.configure(ConfigState, next)
	if _, err := os.Stat(filepath.Join(f.dir, "wireguard", "wg1.conf")); !os.IsNotExist(err) {
		t.Fatal("конфиг удалённого интерфейса остался")
	}
	if f.last(EventStateResult)["version"] != float64(8) {
		t.Fatal("итог новой версии — событием")
	}
}

func TestStateRejected(t *testing.T) {
	f := setup(t)

	if err := f.configure(ConfigState, "строка"); code(err) != protocol.CodeConfigRejected {
		t.Fatalf("не объект: %v", err)
	}
	bad := sampleState(1)
	bad.Interfaces[0].Name = "wg0; rm -rf /"
	if err := f.configure(ConfigState, bad); code(err) != protocol.CodeConfigRejected || !strings.Contains(err.Error(), "имя интерфейса") {
		t.Fatalf("%v", err)
	}
	if err := f.configure("nope", map[string]any{}); code(err) != protocol.CodeConfigRejected {
		t.Fatalf("чужой ключ: %v", err)
	}
	if len(f.agent.list()) != 0 {
		t.Fatalf("отказ — без итога: %v", f.agent.types())
	}
}

func TestForeignConfigIsKept(t *testing.T) {
	f := setup(t)

	foreign := []byte("[Interface]\nPrivateKey = CHUZHOY\n")
	_ = os.MkdirAll(filepath.Join(f.dir, "wireguard"), 0o700)
	_ = os.WriteFile(filepath.Join(f.dir, "wireguard", "wg0.conf"), foreign, 0o600)

	_ = f.configure(ConfigState, sampleState(1))
	wg0 := f.last(EventStateResult)["interfaces"].([]any)[0].(map[string]any)
	if wg0["status"] != "error" || !strings.Contains(wg0["message"].(string), "чужой конфиг") {
		t.Fatalf("%+v", wg0)
	}
	if conf, _ := os.ReadFile(filepath.Join(f.dir, "wireguard", "wg0.conf")); string(conf) != string(foreign) {
		t.Fatal("чужой конфиг перезаписан")
	}
}

func TestRetryPublishesChangedResult(t *testing.T) {
	f := setup(t)

	f.sys.set(func(s *faultySystem) {
		s.errors = []string{"udp/51830 уже слушает другой процесс"}
	})
	_ = f.configure(ConfigState, sampleState(3))
	if health := f.service.Health(); !health.OK || !strings.Contains(health.Message, "уже слушает") {
		t.Fatalf("ошибки применения ok не роняют, они в message: %+v", health)
	}

	// Тот же итог — события нет.
	f.service.retryOnce()
	if len(f.agent.list()) != 1 {
		t.Fatalf("%v", f.agent.types())
	}

	// Конфликт ушёл — итог изменился: событие state.result, повторы прекращаются.
	f.sys.set(func(s *faultySystem) { s.errors = nil })
	f.service.retryOnce()
	events := f.agent.list()
	if len(events) != 2 || events[1].typ != EventStateResult || len(events[1].data["errors"].([]any)) != 0 {
		t.Fatalf("%+v", events)
	}

	f.sys.set(func(s *faultySystem) { s.errors = []string{"не должно примениться"} })
	f.service.retryOnce()
	if len(f.agent.list()) != 2 {
		t.Fatal("без ошибок повторов нет")
	}
}

func TestResultResentWhenAgentAccepts(t *testing.T) {
	f := setup(t)
	f.agent.down = true

	_ = f.configure(ConfigState, sampleState(5))
	if len(f.agent.list()) != 0 {
		t.Fatal("агент не на связи")
	}

	f.agent.mu.Lock()
	f.agent.down = false
	f.agent.mu.Unlock()
	f.service.resendOnce()
	f.service.resendOnce()
	if got := f.agent.types(); len(got) != 1 || got[0] != EventStateResult {
		t.Fatalf("итог — один раз, когда агент его принял: %v", got)
	}
}

func TestRouteChangeReapplies(t *testing.T) {
	f := setup(t)
	_ = f.configure(ConfigState, sampleState(4))

	f.sys.set(func(s *faultySystem) { s.tunnelLoss = 100 })
	for i := 0; i < failover.FailoverAfterFailures; i++ {
		f.service.probeOnce()
	}

	if got := strings.Join(f.agent.types(), ","); got != "state.result,route.changed,state.result" {
		t.Fatalf("события: %s", got)
	}
	changed := f.last(EventRouteChanged)
	route := changed["routes"].([]any)[0].(map[string]any)
	if changed["version"] != float64(4) || route["activeRoute"] != "direct" || route["activeCandidate"] != float64(1) {
		t.Fatalf("%+v", changed)
	}

	metrics := f.metrics()
	tunnel := metrics["tunnels"].([]any)[0].(map[string]any)
	if tunnel["name"] != "wgt1" || tunnel["lossPercent"] != float64(100) {
		t.Fatalf("%+v", metrics)
	}
	if metrics["forwards"].([]any)[0].(map[string]any)["activeRoute"] != "direct" {
		t.Fatalf("%+v", metrics)
	}
}

func TestRestartCommand(t *testing.T) {
	f := setup(t)
	restart := func(name string) (any, error) {
		args, _ := json.Marshal(map[string]string{"name": name})

		return f.service.RestartCommand(context.Background(), &worker.Call{ID: "c1", Type: CommandRestart, Args: args})
	}

	if _, err := restart("wg0"); code(err) != CodeInterfaceNotFound {
		t.Fatalf("до настройки интерфейса нет: %v", err)
	}

	_ = f.configure(ConfigState, sampleState(1))

	if result, err := restart("wg0"); err != nil || result.(map[string]string)["status"] != "up" {
		t.Fatalf("%v %v", result, err)
	}
	if _, err := restart("wg1"); code(err) != CodeInterfaceDisabled {
		t.Fatalf("выключенный: %v", err)
	}
	if _, err := restart("wg9"); code(err) != CodeInterfaceNotFound {
		t.Fatalf("%v", err)
	}
	if _, err := restart("wg0; reboot"); code(err) != CodeArgsInvalid {
		t.Fatalf("%v", err)
	}
}

func TestMetricsAndHealth(t *testing.T) {
	f := setup(t)

	empty := f.metrics()
	for _, key := range []string{"interfaces", "tunnels", "forwards", "nodeProbes"} {
		if list, ok := empty[key].([]any); !ok || len(list) != 0 {
			t.Fatalf("%s: %+v", key, empty)
		}
	}
	if health := f.service.Health(); !health.OK || health.Message != "" {
		t.Fatalf("%+v", health)
	}

	_ = f.configure(ConfigState, sampleState(1))
	_ = f.configure(ConfigProbes, map[string]any{"targets": []any{map[string]any{"nodeId": "node-2", "host": "203.0.113.20"}}})
	f.service.probeOnce()
	f.service.probeNodesOnce()

	metrics := f.metrics()
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
	if tunnel := metrics["tunnels"].([]any)[0].(map[string]any); tunnel["mtuOk"] != true {
		t.Fatalf("%+v", tunnel)
	}

	_ = f.configure(ConfigProbes, nil)
	if len(f.metrics()["nodeProbes"].([]any)) != 0 {
		t.Fatal("цели проб удалены — проб нет")
	}
}

func TestNodeInfoOnChange(t *testing.T) {
	f := setup(t)

	f.service.infoOnce()
	f.service.infoOnce()
	info := f.last(EventNodeInfo)
	if len(f.agent.list()) != 1 || info["wgVersion"] != "dry-run" || info["wgMode"] != "userspace" || info["udpPorts"] == nil {
		t.Fatalf("%v %+v", f.agent.types(), info)
	}
}

func TestDeleteStateAndCleanup(t *testing.T) {
	f := setup(t)
	confDir := filepath.Join(f.dir, "wireguard")
	stateFile := filepath.Join(f.dir, "state", "state.json")

	_ = f.configure(ConfigState, sampleState(1))
	if err := f.configure(ConfigState, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(confDir, "wg0.conf")); !os.IsNotExist(err) {
		t.Fatal("удаление настройки снимает интерфейсы воркера")
	}
	if f.service.LastResult() != nil {
		t.Fatal("итог забыт")
	}

	// После снятия — ни повторов, ни переприменения по пробам.
	f.sys.set(func(s *faultySystem) { s.errors = []string{"x"}; s.tunnelLoss = 100 })
	for i := 0; i < 4; i++ {
		f.service.retryOnce()
		f.service.probeOnce()
	}
	if len(f.agent.list()) != 1 {
		t.Fatalf("%v", f.agent.types())
	}

	// wg cleanup (воркер остановлен): созданное воркером и файл состояния — убраны.
	f.sys.set(func(s *faultySystem) { s.errors = nil })
	_ = f.configure(ConfigState, sampleState(2))
	f.sys.Cleanup()
	if _, err := os.Stat(stateFile); !os.IsNotExist(err) {
		t.Fatal("cleanup удаляет файл состояния")
	}
	if _, err := os.Stat(filepath.Join(confDir, "wg0.conf")); !os.IsNotExist(err) {
		t.Fatal("cleanup удаляет конфиги")
	}
}

func TestRunStops(t *testing.T) {
	f := setup(t)
	f.service.timing = timings{retry: time.Millisecond, tunnelProbe: time.Millisecond, nodeProbe: time.Millisecond, hostInfo: time.Millisecond, resend: time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { f.service.Run(ctx); close(done) }()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run не завершился")
	}
	if f.last(EventNodeInfo) == nil {
		t.Fatal("сведения об узле — сразу после запуска")
	}
}
