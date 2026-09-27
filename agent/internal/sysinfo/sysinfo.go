// Package sysinfo — сведения о хосте и метрики из /proc.
package sysinfo

import (
	"bufio"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"wgadmin/agent/internal/protocol"
	"wgadmin/agent/internal/shell"
)

// NicCounters — счётчики байтов интерфейса.
type NicCounters struct {
	Rx int64
	Tx int64
}

// Виртуальные интерфейсы Docker и loopback в метрики не идут.
var skippedNic = regexp.MustCompile(`^(lo|veth|docker|br-)`)

// ParseProcNetDev — счётчики из /proc/net/dev.
func ParseProcNetDev(text string) map[string]NicCounters {
	counters := map[string]NicCounters{}
	lines := strings.Split(text, "\n")

	if len(lines) < 2 {
		return counters
	}

	for _, line := range lines[2:] {
		name, rest, ok := strings.Cut(line, ":")
		name = strings.TrimSpace(name)

		if !ok || name == "" || skippedNic.MatchString(name) {
			continue
		}

		fields := strings.Fields(rest)
		if len(fields) < 9 {
			continue
		}

		rx, _ := strconv.ParseInt(fields[0], 10, 64)
		tx, _ := strconv.ParseInt(fields[8], 10, 64)
		counters[name] = NicCounters{Rx: rx, Tx: tx}
	}

	return counters
}

// NicRates — скорости по дельте; новый интерфейс или сброс счётчика — 0.
func NicRates(prev, next map[string]NicCounters, elapsed time.Duration) []protocol.NicRate {
	seconds := elapsed.Seconds()
	if seconds < 0.001 {
		seconds = 0.001
	}

	rate := func(after int64, before int64, known bool) int64 {
		if !known || after < before {
			return 0
		}

		return int64(float64(after-before)/seconds + 0.5)
	}

	names := make([]string, 0, len(next))
	for name := range next {
		names = append(names, name)
	}
	sort.Strings(names)

	rates := make([]protocol.NicRate, 0, len(names))
	for _, name := range names {
		before, known := prev[name]
		rates = append(rates, protocol.NicRate{
			Name:  name,
			RxBps: rate(next[name].Rx, before.Rx, known),
			TxBps: rate(next[name].Tx, before.Tx, known),
		})
	}

	return rates
}

func parsePorts(tables []string, listeningOnly bool) []int {
	set := map[int]bool{}

	for _, table := range tables {
		lines := strings.Split(table, "\n")
		for _, line := range lines[min(1, len(lines)):] {
			fields := strings.Fields(line)
			if len(fields) < 4 {
				continue
			}

			_, hexPort, ok := strings.Cut(fields[1], ":")
			if !ok || (listeningOnly && fields[3] != "0A") {
				continue
			}

			if port, err := strconv.ParseInt(hexPort, 16, 32); err == nil && port > 0 {
				set[int(port)] = true
			}
		}
	}

	ports := make([]int, 0, len(set))
	for port := range set {
		ports = append(ports, port)
	}
	sort.Ints(ports)

	if len(ports) > 1000 {
		ports = ports[:1000]
	}

	return ports
}

// ParseUDPPorts — локальные UDP-порты из /proc/net/udp{,6}.
func ParseUDPPorts(tables []string) []int { return parsePorts(tables, false) }

// ParseListeningTCPPorts — слушающие TCP-порты (состояние 0A).
func ParseListeningTCPPorts(tables []string) []int { return parsePorts(tables, true) }

// DetectWgMode — `kernel` (модуль ядра) или `userspace` (wireguard-go).
func DetectWgMode(wgInterfaces, kernelInterfaces []string, moduleLoaded bool) string {
	if len(wgInterfaces) == 0 {
		if moduleLoaded {
			return "kernel"
		}

		return "userspace"
	}

	kernel := map[string]bool{}
	for _, name := range kernelInterfaces {
		kernel[name] = true
	}
	for _, name := range wgInterfaces {
		if !kernel[name] {
			return "userspace"
		}
	}

	return "kernel"
}

func readFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	return string(data)
}

// WgMode — реализация WireGuard на хосте.
func WgMode() string {
	wgShow := shell.Exec(shell.DefaultTimeout, "wg", "show", "interfaces")
	links := shell.Exec(shell.DefaultTimeout, "ip", "-o", "link", "show", "type", "wireguard")
	_, moduleErr := os.Stat("/sys/module/wireguard")

	var wgNames, kernelNames []string

	if wgShow.Code == 0 {
		wgNames = strings.Fields(wgShow.Stdout)
	}
	if links.Code == 0 {
		for _, line := range strings.Split(links.Stdout, "\n") {
			parts := strings.SplitN(line, ":", 3)
			if len(parts) >= 2 {
				name := strings.SplitN(strings.TrimSpace(parts[1]), "@", 2)[0]
				if name != "" {
					kernelNames = append(kernelNames, name)
				}
			}
		}
	}

	return DetectWgMode(wgNames, kernelNames, moduleErr == nil)
}

// UDPPorts — занятые UDP-порты хоста.
func UDPPorts() []int {
	return ParseUDPPorts([]string{readFile("/proc/net/udp"), readFile("/proc/net/udp6")})
}

// TCPPorts — слушающие TCP-порты хоста.
func TCPPorts() []int {
	return ParseListeningTCPPorts([]string{readFile("/proc/net/tcp"), readFile("/proc/net/tcp6")})
}

func readInt(path string) *int64 {
	raw := strings.TrimSpace(readFile(path))
	if raw == "" {
		return nil
	}

	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil
	}

	return &value
}

// Metrics — метрики хоста с дельтами CPU и сетевых интерфейсов.
type Metrics struct {
	mu        sync.Mutex
	prevNics  map[string]NicCounters
	prevAt    time.Time
	prevIdle  int64
	prevTotal int64
}

func (m *Metrics) cpuPercent() float64 {
	line := strings.SplitN(readFile("/proc/stat"), "\n", 2)[0]
	fields := strings.Fields(line)

	if len(fields) < 5 {
		return 0
	}

	var total, idle int64

	for i, field := range fields[1:] {
		value, _ := strconv.ParseInt(field, 10, 64)
		total += value
		if i == 3 || i == 4 {
			idle += value
		}
	}

	prevIdle, prevTotal := m.prevIdle, m.prevTotal
	m.prevIdle, m.prevTotal = idle, total

	if prevTotal == 0 || total <= prevTotal {
		return 0
	}

	busy := float64(total-prevTotal) - float64(idle-prevIdle)
	percent := busy / float64(total-prevTotal) * 100

	return float64(int64(max(0, min(100, percent))*10+0.5)) / 10
}

func memInfo() (used, total int64) {
	values := map[string]int64{}
	scanner := bufio.NewScanner(strings.NewReader(readFile("/proc/meminfo")))

	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 {
			value, _ := strconv.ParseInt(fields[1], 10, 64)
			values[strings.TrimSuffix(fields[0], ":")] = value * 1024
		}
	}

	total = values["MemTotal"]
	available, ok := values["MemAvailable"]
	if !ok {
		available = values["MemFree"]
	}

	return total - available, total
}

func loadAvg() (float64, float64, float64) {
	fields := strings.Fields(readFile("/proc/loadavg"))
	if len(fields) < 3 {
		return 0, 0, 0
	}

	l1, _ := strconv.ParseFloat(fields[0], 64)
	l5, _ := strconv.ParseFloat(fields[1], 64)
	l15, _ := strconv.ParseFloat(fields[2], 64)

	return l1, l5, l15
}

func uptime() int64 {
	fields := strings.Fields(readFile("/proc/uptime"))
	if len(fields) == 0 {
		return 0
	}

	value, _ := strconv.ParseFloat(fields[0], 64)

	return int64(value + 0.5)
}

func disk() (used, total int64) {
	var stat syscall.Statfs_t

	if err := syscall.Statfs("/", &stat); err != nil {
		return 0, 0
	}

	total = int64(stat.Blocks) * int64(stat.Bsize)

	return total - int64(stat.Bfree)*int64(stat.Bsize), total
}

// Collect — снимок метрик хоста.
func (m *Metrics) Collect() protocol.SysMetrics {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	counters := ParseProcNetDev(readFile("/proc/net/dev"))
	elapsed := now.Sub(m.prevAt)
	if m.prevAt.IsZero() {
		elapsed = 0
	}
	nics := NicRates(m.prevNics, counters, elapsed)
	m.prevNics, m.prevAt = counters, now
	if len(nics) > 50 {
		nics = nics[:50]
	}

	memUsed, memTotal := memInfo()
	diskUsed, diskTotal := disk()
	l1, l5, l15 := loadAvg()

	return protocol.SysMetrics{
		CPUPercent:     m.cpuPercent(),
		Load1:          l1,
		Load5:          l5,
		Load15:         l15,
		Nics:           nics,
		ConntrackCount: readInt("/proc/sys/net/netfilter/nf_conntrack_count"),
		ConntrackMax:   readInt("/proc/sys/net/netfilter/nf_conntrack_max"),
		MemUsedBytes:   memUsed,
		MemTotalBytes:  memTotal,
		DiskUsedBytes:  diskUsed,
		DiskTotalBytes: diskTotal,
		UptimeSec:      uptime(),
	}
}

var prettyName = regexp.MustCompile(`(?m)^PRETTY_NAME="?([^"\n]+)"?`)

// OsInfo — сведения о хосте для отчёта.
func OsInfo() protocol.OsInfo {
	var uname syscall.Utsname
	_ = syscall.Uname(&uname)

	release := utsString(uname.Release[:])
	hostname, _ := os.Hostname()

	distro := ""
	if match := prettyName.FindStringSubmatch(readFile("/etc/os-release")); match != nil {
		distro = match[1]
	}

	return protocol.OsInfo{
		Platform: runtime.GOOS,
		Release:  release,
		Distro:   distro,
		Arch:     runtime.GOARCH,
		Hostname: hostname,
		Kernel:   release,
		WgMode:   WgMode(),
		UDPPorts: UDPPorts(),
		TCPPorts: TCPPorts(),
	}
}

func utsString[T int8 | uint8](chars []T) string {
	var b strings.Builder

	for _, c := range chars {
		if c == 0 {
			break
		}
		b.WriteByte(byte(c))
	}

	return b.String()
}
