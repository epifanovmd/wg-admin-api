package agent

import (
	"os"
	"syscall"
	"testing"
	"time"

	"wgadmin/agent/internal/apply"
	"wgadmin/agent/internal/failover"
	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/socks"
)

func replicaForward(extraPort int) protocol.DesiredState {
	forwards := []protocol.Forward{{
		ID: "iface", Proto: "udp", ListenPort: 51820, TargetIP: "10.0.0.1", TargetPort: 51820,
		Candidates: []protocol.Candidate{
			{TargetIP: "10.0.0.1", NodeID: "a"},
			{TargetIP: "10.0.0.2", NodeID: "d"},
		},
	}}
	if extraPort > 0 {
		forwards = append(forwards, protocol.Forward{ID: "extra", Proto: "tcp", ListenPort: extraPort, TargetIP: "10.0.0.9", TargetPort: extraPort})
	}

	return protocol.DesiredState{Forwards: forwards}
}

// Пробы идут секунды; если за это время цикл конфигурации применил новую
// версию, переключение маршрута не должно вернуть прежнюю.
func TestProbeReappliesLatestState(t *testing.T) {
	a := &Agent{health: failover.NewHealth(), appliedVersion: -1}

	var applied []protocol.DesiredState
	a.applyFn = func(desired protocol.DesiredState) apply.Result {
		applied = append(applied, desired)

		return apply.Result{}
	}

	old := replicaForward(8443)
	old.Version = 1
	newer := replicaForward(0)
	newer.Version = 2

	a.applyState(old)

	for i := 0; i < failover.FailoverAfterFailures-1; i++ {
		a.health.Record("ip:10.0.0.1", false)
	}

	a.probeTunnels = func([]protocol.Tunnel) []protocol.TunnelProbe { return nil }
	a.probeIPs = func([]string) map[string]bool {
		a.applyState(newer)

		return map[string]bool{"10.0.0.1": false, "10.0.0.2": true}
	}

	a.probeOnce()

	last := applied[len(applied)-1]
	if last.Version != 2 {
		t.Fatalf("переприменена версия %d, ожидалась 2 (последняя)", last.Version)
	}
	if a.current.Version != 2 {
		t.Fatalf("текущая версия %d, ожидалась 2", a.current.Version)
	}
}

// Переустановка и обновление перезапускают агента сигналом HUP: созданное
// им на хосте остаётся — клиенты не теряют связь; SIGTERM — полный откат.
func TestStopRollsBackOnlyOnTerm(t *testing.T) {
	for _, tc := range []struct {
		signal   os.Signal
		rollback bool
	}{
		{syscall.SIGTERM, true},
		{syscall.SIGINT, true},
		{syscall.SIGHUP, false},
	} {
		a := &Agent{applier: apply.New(t.TempDir(), t.TempDir()+"/state.json", nil), socks: socks.New()}
		rolledBack, exited := false, -1
		a.rollbackFn = func() { rolledBack = true }
		a.exitFn = func(code int) { exited = code }

		a.stop(tc.signal)

		if rolledBack != tc.rollback || exited != 0 {
			t.Fatalf("%s: откат %v (ожидался %v), выход %d", tc.signal, rolledBack, tc.rollback, exited)
		}
	}
}

// Перезапуск после обновления ждёт текущего применения: выход посреди
// wg-quick up оставил бы интерфейсы и правила наполовину настроенными.
func TestRestartAfterUpdateWaitsForApply(t *testing.T) {
	a := &Agent{applier: apply.New(t.TempDir(), t.TempDir()+"/state.json", nil), socks: socks.New()}
	rolledBack := false
	exited := make(chan int, 1)
	a.rollbackFn = func() { rolledBack = true }
	a.exitFn = func(code int) { exited <- code }

	a.applier.Lock()
	go a.restartAfterUpdate()

	select {
	case <-exited:
		t.Fatal("выход во время применения")
	case <-time.After(100 * time.Millisecond):
	}

	a.applier.Unlock()

	select {
	case code := <-exited:
		if code != 0 || rolledBack {
			t.Fatalf("выход %d, откат %v: ожидался выход 0 без отката", code, rolledBack)
		}
	case <-time.After(time.Second):
		t.Fatal("агент не завершился после применения")
	}
}
