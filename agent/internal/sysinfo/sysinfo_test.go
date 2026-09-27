package sysinfo

import (
	"reflect"
	"testing"
	"time"

	"wgadmin/agent/internal/protocol"
)

const procNetDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0: 5000      50    0    0    0     0          0         0     8000      60    0    0    0     0       0          0
   wg0: 2000      20    0    0    0     0          0         0     3000      30    0    0    0     0       0          0
vethab12: 1       1    0    0    0     0          0         0        1       1    0    0    0     0       0          0
docker0: 1        1    0    0    0     0          0         0        1       1    0    0    0     0       0          0
br-1234: 1        1    0    0    0     0          0         0        1       1    0    0    0     0       0          0
`

func TestParseProcNetDev(t *testing.T) {
	counters := ParseProcNetDev(procNetDev)

	if len(counters) != 2 || counters["eth0"] != (NicCounters{Rx: 5000, Tx: 8000}) {
		t.Fatalf("%+v", counters)
	}
}

func TestNicRates(t *testing.T) {
	prev := map[string]NicCounters{"eth0": {Rx: 1000, Tx: 2000}, "wg0": {Rx: 9000, Tx: 9000}}
	next := map[string]NicCounters{"eth0": {Rx: 3000, Tx: 6000}, "wg0": {Rx: 100, Tx: 100}, "eth1": {Rx: 50, Tx: 50}}

	want := []protocol.NicRate{
		{Name: "eth0", RxBps: 1000, TxBps: 2000},
		{Name: "eth1"},
		{Name: "wg0"},
	}
	if got := NicRates(prev, next, 2*time.Second); !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
}

func TestParsePorts(t *testing.T) {
	udp := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  1: 00000000:CA6C 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 1 2 0000000000000000 0
  2: 0100007F:0035 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 1 2 0000000000000000 0
  3: 00000000:CA6C 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 1 2 0000000000000000 0
`
	udp6 := `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  1: 00000000000000000000000000000000:CA6D 00000000000000000000000000000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 1 2 0000000000000000 0
`
	if got := ParseUDPPorts([]string{udp, udp6}); !reflect.DeepEqual(got, []int{53, 51820, 51821}) {
		t.Fatalf("udp: %v", got)
	}

	tcp := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:20FB 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1
   1: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2
   2: 0100007F:1F90 0100007F:D431 01 00000000:00000000 00:00000000 00000000     0        0 3
`
	if got := ParseListeningTCPPorts([]string{tcp}); !reflect.DeepEqual(got, []int{80, 8443}) {
		t.Fatalf("tcp: %v", got)
	}
}

func TestDetectWgMode(t *testing.T) {
	cases := []struct {
		wg, kernel []string
		module     bool
		want       string
	}{
		{[]string{"wg0"}, []string{"wg0"}, true, "kernel"},
		// wireguard-go: интерфейс есть в `wg show`, но это TUN, не тип wireguard.
		{[]string{"wg0"}, nil, false, "userspace"},
		{nil, nil, true, "kernel"},
		{nil, nil, false, "userspace"},
	}
	for _, c := range cases {
		if got := DetectWgMode(c.wg, c.kernel, c.module); got != c.want {
			t.Fatalf("%+v → %s", c, got)
		}
	}
}
