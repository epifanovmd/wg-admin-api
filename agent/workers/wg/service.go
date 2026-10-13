package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/epifanovmd/agent/protocol"
	"github.com/epifanovmd/agent/worker"

	"wgadmin/agent/internal/contract"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/logx"
)

// Ключи настроек, команды и события воркера (манифест — manifest.go).
const (
	ConfigState       = "state"
	ConfigProbes      = "probes"
	CommandRestart    = "interface.restart"
	EventStateResult  = "state.result"
	EventRouteChanged = "route.changed"
	EventNodeInfo     = "node.info"
)

// Коды ошибок команды interface.restart.
const (
	CodeArgsInvalid       = "ARGS_INVALID"
	CodeInterfaceNotFound = "INTERFACE_NOT_FOUND"
	CodeInterfaceDisabled = "INTERFACE_DISABLED"
	CodeRestartFailed     = "RESTART_FAILED"
)

// Сроки и частоты воркера.
type timings struct {
	// retry — повтор применения с ошибками: конфликт мог уйти (освободился
	// порт, убрали чужой туннель).
	retry time.Duration
	// tunnelProbe — пробы туннелей и прямых кандидатов пробросов.
	tunnelProbe time.Duration
	// nodeProbe — пробы нод из настройки probes.
	nodeProbe time.Duration
	// hostInfo — как часто сверять сведения об узле (событие node.info — при изменении).
	hostInfo time.Duration
	// resend — повтор итога, который агент не принял (воркер ещё не зарегистрирован).
	resend time.Duration
}

var defaultTimings = timings{
	retry:       25 * time.Second,
	tunnelProbe: 10 * time.Second,
	nodeProbe:   60 * time.Second,
	hostInfo:    10 * time.Second,
	resend:      5 * time.Second,
}

// maxHealthMessage — длина сообщения пульса, символов.
const maxHealthMessage = 500

// Events — события агенту (worker.Worker).
type Events interface {
	Emit(ctx context.Context, typ string, data any) error
}

// NodeInfo — данные события node.info.
type NodeInfo struct {
	WgVersion *string `json:"wgVersion"`
	WgMode    *string `json:"wgMode"`
	Distro    string  `json:"distro,omitempty"`
	Kernel    string  `json:"kernel,omitempty"`
	UDPPorts  []int   `json:"udpPorts"`
	TCPPorts  []int   `json:"tcpPorts"`
}

// Service — состояние воркера wg: желаемое состояние, последний итог, пробы.
type Service struct {
	sys    System
	health *failover.Health
	timing timings

	// applyMu — применения по очереди: настройка, повтор, смена маршрута,
	// перезапуск интерфейса и уборка не пересекаются.
	applyMu sync.Mutex

	mu           sync.Mutex
	events       Events
	ctx          context.Context
	current      *contract.State
	last         *contract.StateResult
	reported     string
	appliedRoute string
	needsRetry   bool
	targets      []contract.ProbeTarget
	tunnelProbes []contract.TunnelProbe
	nodeProbes   []contract.NodeProbe
	infoSent     string

	nodeProbeNow chan struct{}
}

// NewService — воркер поверх системы sys.
func NewService(sys System) *Service {
	return &Service{
		sys:          sys,
		health:       failover.NewHealth(),
		timing:       defaultTimings,
		ctx:          context.Background(),
		nodeProbeNow: make(chan struct{}, 1),
	}
}

// SetEvents — куда слать события.
func (s *Service) SetEvents(events Events) {
	s.mu.Lock()
	s.events = events
	s.mu.Unlock()
}

var (
	interfaceName = regexp.MustCompile(`^[a-zA-Z0-9_=+.-]{1,15}$`)
	tunnelName    = regexp.MustCompile(`^wgt\d{1,5}$`)
)

// Validate — то, что идёт в имена файлов и команды, проверяется до применения.
func Validate(state contract.State) error {
	var problems []string

	validPort := func(port int) bool { return port >= 1 && port <= 65535 }
	for _, iface := range state.Interfaces {
		if !interfaceName.MatchString(iface.Name) {
			problems = append(problems, fmt.Sprintf("имя интерфейса %q: латиница, цифры и _=+.- до 15 символов", iface.Name))
		}
		if !validPort(iface.ListenPort) {
			problems = append(problems, fmt.Sprintf("%s: listenPort %d вне 1–65535", iface.Name, iface.ListenPort))
		}
	}
	for _, tunnel := range state.Tunnels {
		if !tunnelName.MatchString(tunnel.Name) {
			problems = append(problems, fmt.Sprintf("имя туннеля %q: wgt и номер", tunnel.Name))
		}
	}
	for _, forward := range state.Forwards {
		if forward.Proto != "udp" && forward.Proto != "tcp" {
			problems = append(problems, fmt.Sprintf("проброс %q: proto %q — udp или tcp", forward.ID, forward.Proto))
		}
		if !validPort(forward.ListenPort) || !validPort(forward.TargetPort) {
			problems = append(problems, fmt.Sprintf("проброс %q: порт вне 1–65535", forward.ID))
		}
	}

	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}

	return nil
}

// signature — итог без времени: изменился ли он для бэкенда.
func signature(result contract.StateResult) string {
	result.AppliedAt = 0
	data, _ := json.Marshal(result)

	return string(data)
}

// routeKey — активные цели пробросов при текущем здоровье туннелей и реплик.
func (s *Service) routeKey(state contract.State) string {
	var parts []string

	for _, forward := range failover.Resolve(state.Forwards, s.health) {
		parts = append(parts, fmt.Sprintf("%d/%s:%s", forward.ListenPort, forward.Proto, forward.TargetIP))
	}

	return strings.Join(parts, ",")
}

// rejected — отказ в настройке: ошибка с кодом CONFIG_REJECTED.
func rejected(format string, args ...any) error {
	return protocol.NewError(protocol.CodeConfigRejected, fmt.Sprintf(format, args...))
}

// Configure — ключ настроек от агента (worker.Options.Configure): data nil — ключ удалён.
// state применяется сразу, итог — событием state.result: ошибки частей (порт занят, чужой
// конфиг) — в итоге, а не отказ в настройке.
func (s *Service) Configure(_ context.Context, key string, data json.RawMessage) error {
	switch key {
	case ConfigState:
		if data == nil {
			s.DeleteState()

			return nil
		}
		var state contract.State
		if err := json.Unmarshal(data, &state); err != nil {
			return rejected("state: %v", err)
		}
		if err := Validate(state); err != nil {
			return rejected("%v", err)
		}
		s.Apply(state)

		return nil
	case ConfigProbes:
		var probes contract.Probes
		if data != nil {
			if err := json.Unmarshal(data, &probes); err != nil {
				return rejected("probes: %v", err)
			}
		}
		s.SetProbes(probes.Targets)

		return nil
	}

	return rejected("ключ %q воркеру wg не нужен", key)
}

// Apply — применить желаемое состояние; итог — событием state.result.
func (s *Service) Apply(state contract.State) contract.StateResult {
	s.applyMu.Lock()
	result := s.applyLocked(state)
	s.applyMu.Unlock()
	s.publish(result)

	return result
}

// applyLocked — применить state (applyMu занят вызывающим) и запомнить итог.
func (s *Service) applyLocked(state contract.State) contract.StateResult {
	applied := s.sys.Apply(state, s.health)
	result := contract.StateResult{
		Version:    state.Version,
		AppliedAt:  time.Now().UnixMilli(),
		Interfaces: applied.Interfaces,
		Routes:     applied.Routes,
		Errors:     applied.Errors,
	}
	if result.Interfaces == nil {
		result.Interfaces = []contract.InterfaceStatus{}
	}
	if result.Routes == nil {
		result.Routes = []contract.ForwardStatus{}
	}
	if result.Errors == nil {
		result.Errors = []string{}
	}

	s.mu.Lock()
	copied := state
	s.current = &copied
	s.last = &result
	s.appliedRoute = s.routeKey(state)
	s.needsRetry = len(result.Errors) > 0
	s.mu.Unlock()

	if len(result.Errors) > 0 {
		logx.Warn("Конфигурация v%d применена с ошибками: %s", state.Version, strings.Join(result.Errors, "; "))
	} else {
		logx.Info("Конфигурация v%d применена", state.Version)
	}

	return result
}

// emit — событие агенту; связи с агентом ещё нет — ошибка.
func (s *Service) emit(typ string, data any) error {
	s.mu.Lock()
	events, ctx := s.events, s.ctx
	s.mu.Unlock()

	if events == nil {
		return errors.New("нет связи с агентом")
	}

	return events.Emit(ctx, typ, data)
}

// publish — событие state.result, если итог изменился с последнего отданного; агент не
// принял — повтор (resendOnce).
func (s *Service) publish(result contract.StateResult) {
	sig := signature(result)

	s.mu.Lock()
	changed := sig != s.reported
	s.mu.Unlock()

	if !changed {
		return
	}
	if err := s.emit(EventStateResult, result); err != nil {
		logx.Warn("Итог v%d не отправлен: %v — повтор", result.Version, err)

		return
	}

	s.mu.Lock()
	s.reported = sig
	s.mu.Unlock()
}

// DeleteState — снять всё своё (пустое состояние) и забыть настройку.
func (s *Service) DeleteState() {
	s.applyMu.Lock()
	defer s.applyMu.Unlock()

	logx.Info("Настройка state удалена — снимаю созданное воркером")
	applied := s.sys.Apply(contract.State{Interfaces: []contract.Interface{}, Tunnels: []contract.Tunnel{}, Forwards: []contract.Forward{}}, s.health)
	if len(applied.Errors) > 0 {
		logx.Warn("Снятие с ошибками: %s", strings.Join(applied.Errors, "; "))
	}

	s.mu.Lock()
	s.current = nil
	s.last = nil
	s.reported = ""
	s.appliedRoute = ""
	s.needsRetry = false
	s.tunnelProbes = nil
	s.mu.Unlock()
}

// ErrNoInterface — интерфейса нет в желаемом состоянии.
var ErrNoInterface = errors.New("интерфейса нет в конфигурации")

// ErrDisabled — интерфейс выключен в конфигурации.
var ErrDisabled = errors.New("интерфейс выключен в конфигурации")

// Restart — wg-quick down и up интерфейса из желаемого состояния.
func (s *Service) Restart(name string) error {
	s.applyMu.Lock()
	defer s.applyMu.Unlock()

	s.mu.Lock()
	current := s.current
	s.mu.Unlock()

	if current == nil {
		return ErrNoInterface
	}
	for _, iface := range current.Interfaces {
		if iface.Name != name {
			continue
		}
		if !iface.Enabled {
			return ErrDisabled
		}

		return s.sys.Restart(name)
	}

	return ErrNoInterface
}

// RestartCommand — команда interface.restart {name}.
func (s *Service) RestartCommand(_ context.Context, c *worker.Call) (any, error) {
	var args struct {
		Name string `json:"name"`
	}
	if err := c.Decode(&args); err != nil || !interfaceName.MatchString(args.Name) {
		return nil, protocol.NewError(CodeArgsInvalid, "нужно имя интерфейса: {name}")
	}

	switch err := s.Restart(args.Name); {
	case errors.Is(err, ErrNoInterface):
		return nil, protocol.NewError(CodeInterfaceNotFound, args.Name+": "+err.Error())
	case errors.Is(err, ErrDisabled):
		return nil, protocol.NewError(CodeInterfaceDisabled, args.Name+": "+err.Error())
	case err != nil:
		return nil, protocol.NewError(CodeRestartFailed, args.Name+": "+err.Error())
	}

	return map[string]string{"name": args.Name, "status": "up"}, nil
}

// SetProbes — цели проб нод; пробы — сразу.
func (s *Service) SetProbes(targets []contract.ProbeTarget) {
	s.mu.Lock()
	s.targets = targets
	if len(targets) == 0 {
		s.nodeProbes = nil
	}
	s.mu.Unlock()

	select {
	case s.nodeProbeNow <- struct{}{}:
	default:
	}
}

// LastResult — последний итог применения; nil — настройки ещё не было.
func (s *Service) LastResult() *contract.StateResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.last == nil {
		return nil
	}
	result := *s.last

	return &result
}

// retryOnce — переприменить текущее состояние, если прошлое было с ошибками.
func (s *Service) retryOnce() {
	s.applyMu.Lock()

	s.mu.Lock()
	retry := s.needsRetry
	current := s.current
	s.mu.Unlock()

	if !retry || current == nil {
		s.applyMu.Unlock()

		return
	}

	result := s.applyLocked(*current)
	s.applyMu.Unlock()
	s.publish(result)
}

// probeOnce — пробы туннелей и прямых кандидатов; сменился маршрут
// пробросов — переприменение и событие route.changed.
func (s *Service) probeOnce() {
	s.mu.Lock()
	current := s.current
	s.mu.Unlock()

	if current == nil {
		return
	}

	probes := []contract.TunnelProbe{}
	if len(current.Tunnels) > 0 {
		probes = s.sys.ProbeTunnels(current.Tunnels)
	}
	for _, result := range probes {
		s.health.Record(result.Name, result.LossPercent < 100)
	}
	if ips := failover.DirectCandidateIPs(current.Forwards); len(ips) > 0 {
		for ip, ok := range s.sys.ProbeIPs(ips) {
			s.health.Record("ip:"+ip, ok)
		}
	}

	s.mu.Lock()
	s.tunnelProbes = probes
	s.mu.Unlock()

	// Пока шли пробы, могла примениться новая версия: сравнивается и
	// переприменяется актуальное состояние, не снимок до проб.
	s.applyMu.Lock()
	s.mu.Lock()
	latest := s.current
	changed := latest != nil && s.routeKey(*latest) != s.appliedRoute
	s.mu.Unlock()

	if !changed {
		s.applyMu.Unlock()

		return
	}

	logx.Warn("Маршрут пробросов изменился — переприменяю")
	result := s.applyLocked(*latest)
	s.applyMu.Unlock()

	if err := s.emit(EventRouteChanged, map[string]any{"version": result.Version, "routes": result.Routes}); err != nil {
		logx.Warn("Событие route.changed не отправлено: %v", err)
	}
	s.publish(result)
}

// probeNodesOnce — пробы нод из настройки probes.
func (s *Service) probeNodesOnce() {
	s.mu.Lock()
	targets := s.targets
	s.mu.Unlock()

	var probes []contract.NodeProbe
	if len(targets) > 0 {
		probes = s.sys.ProbeNodes(targets)
	}

	s.mu.Lock()
	// Цели могли смениться, пока шли пробы: устаревший итог не нужен.
	if sameTargets(targets, s.targets) {
		s.nodeProbes = probes
	}
	s.mu.Unlock()
}

func sameTargets(a, b []contract.ProbeTarget) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}

	return true
}

func optional(value string) *string {
	if value == "" {
		return nil
	}

	return &value
}

// infoOnce — сведения об узле; изменились с отправленных — событие node.info.
func (s *Service) infoOnce() {
	host := s.sys.Info()
	info := NodeInfo{
		WgVersion: optional(host.WgVersion),
		WgMode:    optional(host.WgMode),
		Distro:    host.Distro,
		Kernel:    host.Kernel,
		UDPPorts:  host.UDPPorts,
		TCPPorts:  host.TCPPorts,
	}
	if info.UDPPorts == nil {
		info.UDPPorts = []int{}
	}
	if info.TCPPorts == nil {
		info.TCPPorts = []int{}
	}
	raw, _ := json.Marshal(info)

	s.mu.Lock()
	same := s.infoSent == string(raw)
	s.mu.Unlock()

	if same || s.emit(EventNodeInfo, info) != nil {
		return
	}

	s.mu.Lock()
	s.infoSent = string(raw)
	s.mu.Unlock()
}

// resendOnce — итог, который агент ещё не принял, — снова.
func (s *Service) resendOnce() {
	if last := s.LastResult(); last != nil {
		s.publish(*last)
	}
}

// Run — фоновые циклы до отмены ctx: повтор применения, пробы туннелей и нод, сведения об
// узле, досылка итога.
func (s *Service) Run(ctx context.Context) {
	s.mu.Lock()
	s.ctx = ctx
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, loop := range []struct {
		every time.Duration
		now   <-chan struct{}
		step  func()
	}{
		{s.timing.retry, nil, s.retryOnce},
		{s.timing.tunnelProbe, nil, s.probeOnce},
		{s.timing.nodeProbe, s.nodeProbeNow, s.probeNodesOnce},
		{s.timing.hostInfo, nil, s.infoOnce},
		{s.timing.resend, nil, s.resendOnce},
	} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.loop(ctx, loop.every, loop.now, loop.step)
		}()
	}
	wg.Wait()
}

func (s *Service) loop(ctx context.Context, every time.Duration, now <-chan struct{}, step func()) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-now:
		}
		step()
	}
}

// Metrics — метрики пульса: только последние значения, без ожидания проб.
func (s *Service) Metrics() map[string]any {
	s.mu.Lock()
	var names []string
	if s.current != nil {
		for _, iface := range s.current.Interfaces {
			names = append(names, iface.Name)
		}
	}
	tunnels := s.tunnelProbes
	nodes := s.nodeProbes
	forwards := []contract.ForwardStatus{}
	if s.last != nil {
		forwards = s.last.Routes
	}
	s.mu.Unlock()

	if tunnels == nil {
		tunnels = []contract.TunnelProbe{}
	}
	if nodes == nil {
		nodes = []contract.NodeProbe{}
	}

	interfaces := []contract.InterfaceStats{}
	if len(names) > 0 {
		interfaces = s.sys.Dump(names)
	}

	return map[string]any{
		"interfaces": interfaces,
		"tunnels":    tunnels,
		"forwards":   forwards,
		"nodeProbes": nodes,
	}
}

// Health — пульс: ok: false — только если воркер на узле работать не может (нет wg); ошибки
// применения — в message (иначе обновление воркера откатится). Метрики — Metrics.
func (s *Service) Health() protocol.Health {
	health := protocol.Health{OK: true}
	if ready := s.sys.Ready(); ready != nil {
		health.OK, health.Message = false, ready.Error()
	} else if last := s.LastResult(); last != nil && len(last.Errors) > 0 {
		health.Message = fmt.Sprintf("применение с ошибками (%d): %s", len(last.Errors), last.Errors[0])
	}
	if runes := []rune(health.Message); len(runes) > maxHealthMessage {
		health.Message = string(runes[:maxHealthMessage])
	}
	health.Metrics, _ = json.Marshal(s.Metrics())

	return health
}
