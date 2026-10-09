package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/logx"
)

// Сроки и частоты воркера.
type timings struct {
	// reply — сколько PUT /config/state ждёт итог (срок агента — 30 с);
	// дольше — ответ «применяется», итог уйдёт событием state.result.
	reply time.Duration
	// retry — повтор применения с ошибками: конфликт мог уйти (освободился
	// порт, убрали чужой туннель).
	retry time.Duration
	// tunnelProbe — пробы туннелей и прямых кандидатов пробросов.
	tunnelProbe time.Duration
	// nodeProbe — пробы нод из настройки probes.
	nodeProbe time.Duration
	// hostInfo — сколько держать сведения об узле для GET /health.
	hostInfo time.Duration
}

var defaultTimings = timings{
	reply:       25 * time.Second,
	retry:       25 * time.Second,
	tunnelProbe: 10 * time.Second,
	nodeProbe:   60 * time.Second,
	hostInfo:    10 * time.Second,
}

// Events — отправка событий агенту.
type Events interface {
	Event(typ string, data any)
}

// Service — состояние воркера wg: желаемое состояние, последний итог, пробы.
type Service struct {
	sys     System
	events  Events
	health  *failover.Health
	version string
	dryRun  bool
	timing  timings

	// applyMu — применения по очереди: настройка, повтор, смена маршрута,
	// перезапуск интерфейса и уборка не пересекаются.
	applyMu sync.Mutex

	mu           sync.Mutex
	current      *desired.State
	last         *desired.StateResult
	reported     string
	appliedRoute string
	needsRetry   bool
	targets      []desired.ProbeTarget
	tunnelProbes []desired.TunnelProbe
	nodeProbes   []desired.NodeProbe
	info         HostInfo
	infoAt       time.Time

	nodeProbeNow chan struct{}
}

// NewService — воркер поверх системы sys.
func NewService(sys System, events Events, version string, dryRun bool) *Service {
	return &Service{
		sys:          sys,
		events:       events,
		health:       failover.NewHealth(),
		version:      version,
		dryRun:       dryRun,
		timing:       defaultTimings,
		nodeProbeNow: make(chan struct{}, 1),
	}
}

var (
	interfaceName = regexp.MustCompile(`^[a-zA-Z0-9_=+.-]{1,15}$`)
	tunnelName    = regexp.MustCompile(`^wgt\d{1,5}$`)
)

// Validate — то, что идёт в имена файлов и команды, проверяется до применения.
func Validate(state desired.State) error {
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
func signature(result desired.StateResult) string {
	result.AppliedAt = 0
	data, _ := json.Marshal(result)

	return string(data)
}

// routeKey — активные цели пробросов при текущем здоровье туннелей и реплик.
func (s *Service) routeKey(state desired.State) string {
	var parts []string

	for _, forward := range failover.Resolve(state.Forwards, s.health) {
		parts = append(parts, fmt.Sprintf("%d/%s:%s", forward.ListenPort, forward.Proto, forward.TargetIP))
	}

	return strings.Join(parts, ",")
}

// applyLocked — применить state (applyMu занят вызывающим) и запомнить итог.
func (s *Service) applyLocked(state desired.State) desired.StateResult {
	applied := s.sys.Apply(state, s.health)
	result := desired.StateResult{
		Version:    state.Version,
		AppliedAt:  time.Now().UnixMilli(),
		Interfaces: applied.Interfaces,
		Routes:     applied.Routes,
		Errors:     applied.Errors,
	}
	if result.Interfaces == nil {
		result.Interfaces = []desired.InterfaceStatus{}
	}
	if result.Routes == nil {
		result.Routes = []desired.ForwardStatus{}
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

// markReported — итог отдан бэкенду (ответом или событием).
func (s *Service) markReported(result desired.StateResult) {
	s.mu.Lock()
	s.reported = signature(result)
	s.mu.Unlock()
}

// publish — событие state.result, если итог изменился с последнего отданного.
func (s *Service) publish(result desired.StateResult) {
	s.mu.Lock()
	changed := signature(result) != s.reported
	if changed {
		s.reported = signature(result)
	}
	s.mu.Unlock()

	if changed {
		s.events.Event("state.result", result)
	}
}

// PutState — применить новое желаемое состояние. Итог не успел к сроку
// ответа — done=false: применение продолжается, итог уйдёт событием.
func (s *Service) PutState(state desired.State) (result desired.StateResult, done bool) {
	finished := make(chan desired.StateResult, 1)

	go func() {
		s.applyMu.Lock()
		defer s.applyMu.Unlock()

		finished <- s.applyLocked(state)
	}()

	select {
	case result = <-finished:
		s.markReported(result)

		return result, true
	case <-time.After(s.timing.reply):
		logx.Warn("Конфигурация v%d применяется дольше %s — итог уйдёт событием", state.Version, s.timing.reply)
		go func() { s.publish(<-finished) }()

		return desired.StateResult{
			Version:    state.Version,
			Interfaces: []desired.InterfaceStatus{},
			Routes:     []desired.ForwardStatus{},
			Errors:     []string{},
		}, false
	}
}

// DeleteState — снять всё своё (пустое состояние) и забыть настройку.
func (s *Service) DeleteState() {
	s.applyMu.Lock()
	defer s.applyMu.Unlock()

	logx.Info("Настройка state удалена — снимаю созданное воркером")
	applied := s.sys.Apply(desired.State{Interfaces: []desired.Interface{}, Tunnels: []desired.Tunnel{}, Forwards: []desired.Forward{}}, s.health)
	if len(applied.Errors) > 0 {
		logx.Warn("Снятие с ошибками: %s", strings.Join(applied.Errors, "; "))
	}
	s.forget()
}

// forget — нет желаемого состояния: ни повторов, ни проб, ни итога.
func (s *Service) forget() {
	s.mu.Lock()
	s.current = nil
	s.last = nil
	s.reported = ""
	s.appliedRoute = ""
	s.needsRetry = false
	s.tunnelProbes = nil
	s.mu.Unlock()
}

// Cleanup — убрать всё созданное воркером; до новой настройки воркер ничего
// не применяет.
func (s *Service) Cleanup() {
	s.applyMu.Lock()
	defer s.applyMu.Unlock()

	s.sys.Cleanup()
	s.forget()
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

// SetProbes — цели проб нод; пробы — сразу.
func (s *Service) SetProbes(targets []desired.ProbeTarget) {
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
func (s *Service) LastResult() *desired.StateResult {
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

	probes := []desired.TunnelProbe{}
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

	s.events.Event("route.changed", map[string]any{"version": result.Version, "routes": result.Routes})
	s.publish(result)
}

// probeNodesOnce — пробы нод из настройки probes.
func (s *Service) probeNodesOnce() {
	s.mu.Lock()
	targets := s.targets
	s.mu.Unlock()

	var probes []desired.NodeProbe
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

func sameTargets(a, b []desired.ProbeTarget) bool {
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

// Run — фоновые циклы: повтор применения, пробы туннелей, пробы нод.
func (s *Service) Run(stop <-chan struct{}) {
	go s.loop(stop, s.timing.retry, nil, s.retryOnce)
	go s.loop(stop, s.timing.tunnelProbe, nil, s.probeOnce)
	go s.loop(stop, s.timing.nodeProbe, s.nodeProbeNow, s.probeNodesOnce)
}

func (s *Service) loop(stop <-chan struct{}, every time.Duration, now <-chan struct{}, step func()) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		case <-now:
		}
		step()
	}
}

// Metrics — ответ GET /metrics: только последние значения, без ожидания проб.
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
	forwards := []desired.ForwardStatus{}
	if s.last != nil {
		forwards = s.last.Routes
	}
	s.mu.Unlock()

	if tunnels == nil {
		tunnels = []desired.TunnelProbe{}
	}
	if nodes == nil {
		nodes = []desired.NodeProbe{}
	}

	interfaces := []desired.InterfaceStats{}
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

// hostInfo — сведения об узле, не чаще раза в timing.hostInfo.
func (s *Service) hostInfo() HostInfo {
	s.mu.Lock()
	if !s.infoAt.IsZero() && time.Since(s.infoAt) < s.timing.hostInfo {
		info := s.info
		s.mu.Unlock()

		return info
	}
	s.mu.Unlock()

	info := s.sys.Info()

	s.mu.Lock()
	s.info, s.infoAt = info, time.Now()
	s.mu.Unlock()

	return info
}

// maxHealthErrors — сколько ошибок применения отдавать в самочувствии
// (ответ GET /health — до 64 КБ).
const maxHealthErrors = 20

// Health — ответ GET /health. ok: false — только если воркер сам не может
// работать: ошибки применения — в info.errors и message.
func (s *Service) Health() map[string]any {
	info := s.hostInfo()
	ready := s.sys.Ready()

	s.mu.Lock()
	last := s.last
	s.mu.Unlock()

	var stateVersion any
	interfaces := []desired.InterfaceStatus{}
	errs := []string{}
	if last != nil {
		stateVersion = last.Version
		interfaces = last.Interfaces
		errs = last.Errors
	}
	if len(errs) > maxHealthErrors {
		errs = errs[:maxHealthErrors]
	}

	var wgMode, wgVersion any
	if info.WgMode != "" {
		wgMode = info.WgMode
	}
	if info.WgVersion != "" {
		wgVersion = info.WgVersion
	}
	udp, tcp := info.UDPPorts, info.TCPPorts
	if udp == nil {
		udp = []int{}
	}
	if tcp == nil {
		tcp = []int{}
	}

	details := map[string]any{
		"version":      s.version,
		"dryRun":       s.dryRun,
		"wgVersion":    wgVersion,
		"wgMode":       wgMode,
		"udpPorts":     udp,
		"tcpPorts":     tcp,
		"stateVersion": stateVersion,
		"interfaces":   interfaces,
		"errors":       errs,
	}
	if info.Distro != "" {
		details["distro"] = info.Distro
	}
	if info.Kernel != "" {
		details["kernel"] = info.Kernel
	}

	body := map[string]any{"ok": ready == nil, "info": details}
	switch {
	case ready != nil:
		body["message"] = ready.Error()
	case len(errs) > 0:
		body["message"] = fmt.Sprintf("применение с ошибками (%d): %s", len(last.Errors), errs[0])
	}

	return body
}
