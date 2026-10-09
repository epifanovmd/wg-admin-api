// Package sysinfo — сведения об узле для самочувствия воркера wg: занятые
// UDP и TCP порты, режим WireGuard, дистрибутив и ядро.
package sysinfo

import (
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"wgadmin/agent/internal/shell"
)

const commandTimeout = 2 * time.Second

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

// WgMode — реализация WireGuard на узле.
func WgMode() string {
	wgShow := shell.Exec(commandTimeout, "wg", "show", "interfaces")
	links := shell.Exec(commandTimeout, "ip", "-o", "link", "show", "type", "wireguard")
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

// UDPPorts — занятые UDP-порты узла (вне Linux — пусто).
func UDPPorts() []int {
	return ParseUDPPorts([]string{readFile("/proc/net/udp"), readFile("/proc/net/udp6")})
}

// TCPPorts — слушающие TCP-порты узла (вне Linux — пусто).
func TCPPorts() []int {
	return ParseListeningTCPPorts([]string{readFile("/proc/net/tcp"), readFile("/proc/net/tcp6")})
}

var prettyName = regexp.MustCompile(`(?m)^PRETTY_NAME="?([^"\n]+)"?`)

// Distro — название дистрибутива из /etc/os-release; "" — неизвестно.
func Distro() string {
	if match := prettyName.FindStringSubmatch(readFile("/etc/os-release")); match != nil {
		return match[1]
	}

	return ""
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
