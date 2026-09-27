// Package agent — циклы агента: конфигурация (состояние из канала связи →
// применить → отчитаться), статистика, пробы туннелей и нод, heartbeat.
package agent

import (
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"wgadmin/agent/internal/api"
	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/cleanup"
	"wgadmin/agent/internal/commands"
	"wgadmin/agent/internal/config"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/link"
	"wgadmin/agent/internal/logx"
	"wgadmin/agent/internal/probe"
	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/socks"
	"wgadmin/agent/internal/state"
	"wgadmin/agent/internal/sysinfo"
	"wgadmin/agent/internal/update"
	"wgadmin/agent/internal/wg"
)

const (
	tunnelProbeEvery = 10 * time.Second
	nodeProbeEvery   = 60 * time.Second
	// retryApplyEvery — повтор применения с ошибкой: конфликт мог уйти
	// (освободился порт, убрали чужой туннель).
	retryApplyEvery = 25 * time.Second
)

// Agent — состояние агента, общее для циклов.
type Agent struct {
	cfg      config.Config
	link     *link.Link
	applier  *apply.Applier
	socks    *socks.Proxies
	executor *commands.Executor
	health   *failover.Health
	metrics  *sysinfo.Metrics
	paths    update.Paths
	codeHash *string

	// Применение и пробы — подменяются в тестах.
	applyFn      func(protocol.DesiredState) apply.Result
	probeTunnels func([]protocol.Tunnel) []protocol.TunnelProbe
	probeIPs     func([]string) map[string]bool
	rollbackFn   func()
	exitFn       func(int)

	// applyMu — применения по очереди: конфигурация и переключение маршрута.
	applyMu        sync.Mutex
	mu             sync.Mutex
	stopping       bool
	appliedVersion int64
	statsInterval  time.Duration
	// states — последнее непримененное состояние (новое вытесняет старое);
	// rateChanged — будит цикл статистики при смене частоты.
	states       chan protocol.DesiredState
	rateChanged  chan struct{}
	current      *protocol.DesiredState
	routes       []protocol.ForwardStatus
	appliedRoute string
	needsRetry   bool
	tunnelProbes []protocol.TunnelProbe
	probeTargets []protocol.ProbeTarget
	nodeProbes   []protocol.NodeProbe
	healthy      bool
}

// New — агент с конфигурацией.
func New(cfg config.Config, paths update.Paths) *Agent {
	client := api.New(cfg.BackendURL, cfg.AgentKey, cfg.PollWait)
	proxies := socks.New()

	a := &Agent{
		cfg:            cfg,
		socks:          proxies,
		applier:        apply.New(cfg.ConfigDir, cfg.StateFile, proxies),
		health:         failover.NewHealth(),
		metrics:        &sysinfo.Metrics{},
		paths:          paths,
		appliedVersion: -1,
		statsInterval:  cfg.StatsInterval,
		states:         make(chan protocol.DesiredState, 1),
		rateChanged:    make(chan struct{}, 1),
		probeTunnels:   probe.Tunnels,
		probeIPs:       probe.IPs,
	}
	a.rollbackFn = func() { cleanup.Owned(cfg.ConfigDir, cfg.StateFile) }
	a.exitFn = os.Exit
	a.applyFn = func(desired protocol.DesiredState) apply.Result {
		return a.applier.Apply(desired, a.health)
	}
	a.link = link.New(link.Options{
		BackendURL: cfg.BackendURL,
		Key:        cfg.AgentKey,
		Transport:  link.Transport(cfg.Transport),
		Known:      a.knownVersion,
		Handler:    link.Handler{State: a.onState, Rate: a.setStatsInterval, Contact: a.onContact},
	}, client)
	// Перезапуск после обновления — без отката созданного: трафик не рвётся.
	a.executor = commands.New(a.link, cfg.ConfigDir, paths, func() { os.Exit(0) })

	if hash, err := update.FileHash(paths.Binary); err == nil {
		a.codeHash = &hash
	}

	return a
}

func (a *Agent) isStopping() bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	return a.stopping
}

// routeKey — активные цели пробросов при текущем здоровье туннелей.
func (a *Agent) routeKey(desired protocol.DesiredState) string {
	var parts []string

	for _, forward := range failover.Resolve(desired.Forwards, a.health) {
		parts = append(parts, fmt.Sprintf("%d/%s:%s", forward.ListenPort, forward.Proto, forward.TargetIP))
	}

	return strings.Join(parts, ",")
}

func (a *Agent) applyState(desired protocol.DesiredState) apply.Result {
	a.applyMu.Lock()
	defer a.applyMu.Unlock()

	return a.applyLocked(desired)
}

func (a *Agent) applyLocked(desired protocol.DesiredState) apply.Result {
	result := a.applyFn(desired)

	a.mu.Lock()
	a.current = &desired
	a.routes = result.Routes
	a.appliedRoute = a.routeKey(desired)
	a.needsRetry = result.ApplyError != nil
	a.mu.Unlock()

	if result.ApplyError != nil {
		logx.Warn("Применение с ошибками: %s", *result.ApplyError)
	}

	return result
}

// report — отчёт; keepError — не менять последнюю ошибку (heartbeat).
func (a *Agent) report(applyError *string, keepError bool, interfaces []protocol.InterfaceStatus) error {
	a.mu.Lock()
	version := a.appliedVersion
	a.mu.Unlock()

	info := sysinfo.OsInfo()
	body := protocol.Report{
		ApplyError:     applyError,
		KeepApplyError: keepError,
		AgentVersion:   a.cfg.Version,
		WgVersion:      wg.Version(),
		CodeHash:       a.codeHash,
		Os:             &info,
		Interfaces:     interfaces,
	}
	if version >= 0 {
		body.AppliedVersion = &version
	}

	return a.link.Report(body)
}

func (a *Agent) knownVersion() int64 {
	a.mu.Lock()
	defer a.mu.Unlock()

	return a.appliedVersion
}

// onContact — бэкенд ответил: обновление агента прошло успешно.
func (a *Agent) onContact() {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.healthy {
		a.healthy = true
		update.Healthy(a.paths)
	}
}

// setStatsInterval — частота статистики от бэкенда; цикл статистики
// просыпается сразу, не досыпая прежний интервал.
func (a *Agent) setStatsInterval(interval time.Duration) {
	a.mu.Lock()
	changed := a.statsInterval != interval
	a.statsInterval = interval
	a.mu.Unlock()

	if changed {
		select {
		case a.rateChanged <- struct{}{}:
		default:
		}
	}
}

// onState — состояние из канала: команды запускаются сразу, применение —
// в цикле конфигурации (чтение канала не блокируется применением).
func (a *Agent) onState(desired protocol.DesiredState) {
	a.executor.Dispatch(desired.Commands)

	a.mu.Lock()
	a.probeTargets = desired.ProbeTargets
	a.mu.Unlock()

	for {
		select {
		case a.states <- desired:
			return
		default:
		}
		select {
		case <-a.states:
		default:
		}
	}
}

func (a *Agent) configLoop() {
	retry := time.NewTicker(retryApplyEvery)
	defer retry.Stop()

	for !a.isStopping() {
		select {
		case desired := <-a.states:
			a.applyDesired(desired)
		case <-retry.C:
			a.retryApply()
		}
	}
}

// applyDesired — применить новую версию, сохранить её и отчитаться.
func (a *Agent) applyDesired(desired protocol.DesiredState) {
	if desired.Version == a.knownVersion() {
		return
	}

	logx.Info("Применяю конфигурацию v%d", desired.Version)
	result := a.applyState(desired)

	a.mu.Lock()
	a.appliedVersion = desired.Version
	a.mu.Unlock()

	if err := state.SaveDesired(a.cfg.DesiredFile, desired); err != nil {
		logx.Warn("Сохранение конфигурации: %s", err)
	}
	if err := a.report(result.ApplyError, false, result.Interfaces); err != nil {
		logx.Warn("Отчёт: %s", err)
	}
}

// retryApply — переприменить текущее состояние, если прошлое было с ошибкой.
func (a *Agent) retryApply() {
	a.mu.Lock()
	retry := a.needsRetry
	current := a.current
	a.mu.Unlock()

	if !retry || current == nil {
		return
	}

	result := a.applyState(*current)
	if err := a.report(result.ApplyError, false, result.Interfaces); err != nil {
		logx.Warn("Отчёт: %s", err)
	}
}

func (a *Agent) statsLoop() {
	for !a.isStopping() {
		dump, err := wg.ReadDump()
		if err != nil {
			dump = wg.Dump{}
		}

		interfaces := make([]protocol.InterfaceStats, 0, len(dump))
		for name, peers := range dump {
			interfaces = append(interfaces, protocol.InterfaceStats{Name: name, Peers: peers})
		}

		sys := a.metrics.Collect()

		a.mu.Lock()
		body := protocol.StatsBody{
			Sys:        &sys,
			Tunnels:    a.tunnelProbes,
			Forwards:   a.routes,
			Socks:      a.socks.Stats(),
			NodeProbes: a.nodeProbes,
			Interfaces: interfaces,
		}
		interval := a.statsInterval
		a.mu.Unlock()

		a.link.PushStats(body)

		select {
		case <-time.After(interval):
		case <-a.rateChanged:
		}
	}
}

// probeLoop — здоровье туннелей и реплик; смена здоровья переключает
// пробросы auto (туннель ↔ напрямую, реплика ↔ реплика).
func (a *Agent) probeLoop() {
	for !a.isStopping() {
		a.probeOnce()
		time.Sleep(tunnelProbeEvery)
	}
}

// probeOnce — одна проверка туннелей и прямых кандидатов; смена маршрута —
// переприменение.
func (a *Agent) probeOnce() {
	a.mu.Lock()
	current := a.current
	a.mu.Unlock()

	var probes []protocol.TunnelProbe
	if current != nil && len(current.Tunnels) > 0 {
		probes = a.probeTunnels(current.Tunnels)
	}
	for _, result := range probes {
		a.health.Record(result.Name, result.LossPercent < 100)
	}

	if current != nil {
		if ips := failover.DirectCandidateIPs(current.Forwards); len(ips) > 0 {
			for ip, ok := range a.probeIPs(ips) {
				a.health.Record("ip:"+ip, ok)
			}
		}
	}

	a.mu.Lock()
	a.tunnelProbes = probes
	a.mu.Unlock()

	// Пока шли пробы, могла примениться новая версия: сравнивается и
	// переприменяется актуальное состояние, не снимок до проб.
	a.applyMu.Lock()
	defer a.applyMu.Unlock()

	a.mu.Lock()
	latest := a.current
	changed := latest != nil && a.routeKey(*latest) != a.appliedRoute
	a.mu.Unlock()

	if changed {
		logx.Warn("Маршрут пробросов изменился — переприменяю")
		a.applyLocked(*latest)
	}
}

func (a *Agent) meshLoop() {
	for !a.isStopping() {
		a.mu.Lock()
		targets := a.probeTargets
		a.mu.Unlock()

		var probes []protocol.NodeProbe
		if len(targets) > 0 {
			probes = probe.Nodes(targets)
		}

		a.mu.Lock()
		a.nodeProbes = probes
		a.mu.Unlock()

		time.Sleep(nodeProbeEvery)
	}
}

func (a *Agent) reportLoop() {
	for !a.isStopping() {
		time.Sleep(a.cfg.ReportInterval)
		if err := a.report(nil, true, nil); err != nil {
			logx.Warn("Отчёт: %s", err)
		}
	}
}

// stop — остановка: дождаться текущего применения, закрыть прокси и
// откатить созданное агентом. Кэш конфигурации остаётся — при старте всё
// поднимется снова. SIGHUP — перезапуск (переустановка, обновление): без
// отката, новый процесс застанет интерфейсы и правила на месте.
func (a *Agent) stop(signal os.Signal) {
	a.mu.Lock()
	if a.stopping {
		a.mu.Unlock()

		return
	}
	a.stopping = true
	a.mu.Unlock()

	a.applier.Lock()
	a.socks.CloseAll()
	if a.link != nil {
		a.link.Close()
	}

	if signal == syscall.SIGHUP {
		logx.Info("%s — перезапуск без отката: созданное агентом остаётся", signal)
	} else {
		logx.Info("%s — откатываю созданное агентом и останавливаюсь", signal)
		a.rollbackFn()
	}
	a.exitFn(0)
}

// Run — запуск агента (блокирует до сигнала остановки).
func (a *Agent) Run() {
	logx.Info("Агент %s запускается, бэкенд: %s", a.cfg.Version, a.cfg.BackendURL)
	if config.IsInsecureBackendURL(a.cfg.BackendURL) {
		logx.Warn("Бэкенд по http: ключ агента и приватные ключи идут в открытом виде — настройте HTTPS")
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)

	go func() { a.stop(<-signals) }()

	// Сначала — сохранённая конфигурация: VPN и релей поднимутся, даже если
	// бэкенд недоступен. Отчёт о ней уйдёт, когда бэкенд ответит.
	if cached := state.LoadDesired(a.cfg.DesiredFile); cached != nil {
		logx.Info("Применяю сохранённую конфигурацию v%s (без бэкенда)", strconv.FormatInt(cached.Version, 10))
		result := a.applyState(*cached)

		a.mu.Lock()
		a.appliedVersion = cached.Version
		if cached.Settings.StatsIntervalMs > 0 {
			a.statsInterval = time.Duration(cached.Settings.StatsIntervalMs) * time.Millisecond
		}
		a.mu.Unlock()

		_ = a.report(result.ApplyError, false, result.Interfaces)
	}

	var wg sync.WaitGroup

	for _, loop := range []func(){a.link.Run, a.configLoop, a.statsLoop, a.reportLoop, a.probeLoop, a.meshLoop} {
		wg.Add(1)
		go func(loop func()) {
			defer wg.Done()
			loop()
		}(loop)
	}
	wg.Wait()
}
