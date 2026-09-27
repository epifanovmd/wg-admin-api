// Package protocol — контракт агента с бэкендом: копия
// src/modules/wg-agent/wg-agent-protocol.ts. Менять синхронно.
package protocol

// Peer — пир интерфейса.
type Peer struct {
	PublicKey    string  `json:"publicKey"`
	PresharedKey *string `json:"presharedKey"`
	AllowedIPs   string  `json:"allowedIps"`
}

// Interface — WireGuard-интерфейс ноды.
type Interface struct {
	Name           string  `json:"name"`
	Enabled        bool    `json:"enabled"`
	ListenPort     int     `json:"listenPort"`
	AddressCidr    string  `json:"addressCidr"`
	AddressV6Cidr  *string `json:"addressV6Cidr"`
	PrivateKey     string  `json:"privateKey"`
	MTU            *int    `json:"mtu"`
	NatEnabled     bool    `json:"natEnabled"`
	CustomPostUp   *string `json:"customPostUp"`
	CustomPostDown *string `json:"customPostDown"`
	Peers          []Peer  `json:"peers"`
}

// Tunnel — IPIP-туннель до другой ноды.
type Tunnel struct {
	Name           string `json:"name"`
	RemoteHost     string `json:"remoteHost"`
	LocalTunnelIP  string `json:"localTunnelIp"`
	RemoteTunnelIP string `json:"remoteTunnelIp"`
	Prefix         int    `json:"prefix"`
	MTU            int    `json:"mtu"`
}

// Candidate — реплика цели проброса (по приоритету).
type Candidate struct {
	TargetIP string  `json:"targetIp"`
	Tunnel   *string `json:"tunnel,omitempty"`
	// ProbeHost — исходный адрес (до разрешения домена), ключ его здоровья.
	ProbeHost string `json:"probeHost,omitempty"`
	NodeID    string `json:"nodeId,omitempty"`
}

// Forward — проброс порта на релее.
type Forward struct {
	ID         string      `json:"id,omitempty"`
	Proto      string      `json:"proto"`
	ListenPort int         `json:"listenPort"`
	TargetIP   string      `json:"targetIp"`
	TargetPort int         `json:"targetPort"`
	FallbackIP *string     `json:"fallbackIp,omitempty"`
	Route      string      `json:"route,omitempty"`
	Tunnel     *string     `json:"tunnel,omitempty"`
	Candidates []Candidate `json:"candidates,omitempty"`
}

// CommandPayload — параметры императивной команды.
type CommandPayload struct {
	InterfaceName string `json:"interfaceName,omitempty"`
	Lines         int    `json:"lines,omitempty"`
	// Hash — sha256 бинаря для agent-update.
	Hash string `json:"hash,omitempty"`
}

// Command — императивная команда бэкенда. TimeoutSec — срок выполнения:
// дольше бэкенд считает команду просроченной.
type Command struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	Payload    CommandPayload `json:"payload"`
	TimeoutSec int            `json:"timeoutSec"`
}

// SocksUser — пользователь SOCKS5: только соль и scrypt-хэш (hex).
type SocksUser struct {
	Username string `json:"username"`
	Salt     string `json:"salt"`
	Hash     string `json:"hash"`
}

// Socks — SOCKS5-прокси через mTLS.
type Socks struct {
	ID                  string      `json:"id"`
	ListenPort          int         `json:"listenPort"`
	CertPem             string      `json:"certPem"`
	KeyPem              string      `json:"keyPem"`
	CaPem               string      `json:"caPem"`
	AllowedFingerprints []string    `json:"allowedFingerprints"`
	Users               []SocksUser `json:"users"`
}

// ProbeTarget — нода для проверки связности.
type ProbeTarget struct {
	NodeID string `json:"nodeId"`
	Host   string `json:"host"`
}

// Settings — параметры агента от бэкенда.
type Settings struct {
	StatsIntervalMs int `json:"statsIntervalMs"`
}

// DesiredState — желаемое состояние ноды.
type DesiredState struct {
	Version      int64         `json:"version"`
	NodeID       string        `json:"nodeId"`
	NodeName     string        `json:"nodeName"`
	Interfaces   []Interface   `json:"interfaces"`
	Tunnels      []Tunnel      `json:"tunnels"`
	Forwards     []Forward     `json:"forwards"`
	Socks        []Socks       `json:"socks,omitempty"`
	ProbeTargets []ProbeTarget `json:"probeTargets,omitempty"`
	Commands     []Command     `json:"commands"`
	Settings     Settings      `json:"settings"`
}

// InterfaceStatus — фактический статус интерфейса.
type InterfaceStatus struct {
	Name    string  `json:"name"`
	Status  string  `json:"status"`
	Message *string `json:"message,omitempty"`
}

// ForwardStatus — активный маршрут проброса.
type ForwardStatus struct {
	ID              string `json:"id"`
	ActiveRoute     string `json:"activeRoute"`
	ActiveCandidate *int   `json:"activeCandidate,omitempty"`
	ActiveNodeID    string `json:"activeNodeId,omitempty"`
}

// TunnelProbe — проверка туннеля с этой стороны.
type TunnelProbe struct {
	Name        string   `json:"name"`
	RttMs       *float64 `json:"rttMs"`
	LossPercent float64  `json:"lossPercent"`
	MtuOk       *bool    `json:"mtuOk"`
}

// NodeProbe — проба другой ноды.
type NodeProbe struct {
	NodeID      string   `json:"nodeId"`
	RttMs       *float64 `json:"rttMs"`
	LossPercent float64  `json:"lossPercent"`
}

// SocksStats — соединения и трафик прокси.
type SocksStats struct {
	ID          string `json:"id"`
	Connections int    `json:"connections"`
	RxBytes     int64  `json:"rxBytes"`
	TxBytes     int64  `json:"txBytes"`
}

// NicRate — скорость сетевого интерфейса хоста.
type NicRate struct {
	Name  string `json:"name"`
	RxBps int64  `json:"rxBps"`
	TxBps int64  `json:"txBps"`
}

// SysMetrics — метрики хоста.
type SysMetrics struct {
	CPUPercent     float64   `json:"cpuPercent"`
	Load1          float64   `json:"load1"`
	Load5          float64   `json:"load5"`
	Load15         float64   `json:"load15"`
	Nics           []NicRate `json:"nics"`
	ConntrackCount *int64    `json:"conntrackCount"`
	ConntrackMax   *int64    `json:"conntrackMax"`
	MemUsedBytes   int64     `json:"memUsedBytes"`
	MemTotalBytes  int64     `json:"memTotalBytes"`
	DiskUsedBytes  int64     `json:"diskUsedBytes"`
	DiskTotalBytes int64     `json:"diskTotalBytes"`
	UptimeSec      int64     `json:"uptimeSec"`
}

// PeerStat — счётчики пира из `wg show dump`.
type PeerStat struct {
	PublicKey     string  `json:"publicKey"`
	RxBytes       int64   `json:"rxBytes"`
	TxBytes       int64   `json:"txBytes"`
	LastHandshake *int64  `json:"lastHandshake"`
	Endpoint      *string `json:"endpoint"`
}

// InterfaceStats — пиры интерфейса.
type InterfaceStats struct {
	Name  string     `json:"name"`
	Peers []PeerStat `json:"peers"`
}

// StatsBody — периодическая статистика.
type StatsBody struct {
	// Seq — номер тика в рамках запуска агента: бэкенд отбрасывает повторы.
	Seq int64 `json:"seq,omitempty"`
	// BootID — идентификатор запуска агента: при перезапуске нумерация заново.
	BootID string `json:"bootId,omitempty"`
	// CollectedAt и SentAt — моменты сбора и отправки по часам агента (unix ms):
	// по их разнице бэкенд восстанавливает момент сбора на своих часах.
	CollectedAt int64            `json:"collectedAt,omitempty"`
	SentAt      int64            `json:"sentAt,omitempty"`
	Sys         *SysMetrics      `json:"sys,omitempty"`
	Tunnels     []TunnelProbe    `json:"tunnels,omitempty"`
	Forwards    []ForwardStatus  `json:"forwards,omitempty"`
	Socks       []SocksStats     `json:"socks,omitempty"`
	NodeProbes  []NodeProbe      `json:"nodeProbes,omitempty"`
	Interfaces  []InterfaceStats `json:"interfaces"`
}

// OsInfo — сведения о хосте.
type OsInfo struct {
	Platform string `json:"platform,omitempty"`
	Release  string `json:"release,omitempty"`
	Distro   string `json:"distro,omitempty"`
	Arch     string `json:"arch,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	Kernel   string `json:"kernel,omitempty"`
	WgMode   string `json:"wgMode,omitempty"`
	UDPPorts []int  `json:"udpPorts"`
	TCPPorts []int  `json:"tcpPorts"`
}

// Report — отчёт о применении. ApplyError различает «не менять» (Keep) и
// «очистить» (nil): периодический heartbeat не стирает последнюю ошибку.
type Report struct {
	AppliedVersion *int64
	ApplyError     *string
	KeepApplyError bool
	AgentVersion   string
	WgVersion      *string
	CodeHash       *string
	Os             *OsInfo
	Interfaces     []InterfaceStatus
}

// Body — JSON тела отчёта с учётом «не менять ошибку».
func (r Report) Body() map[string]any {
	body := map[string]any{"agentVersion": r.AgentVersion}

	if r.AppliedVersion != nil {
		body["appliedVersion"] = *r.AppliedVersion
	}
	if !r.KeepApplyError {
		body["applyError"] = r.ApplyError
	}
	body["wgVersion"] = r.WgVersion
	if r.CodeHash != nil {
		body["codeHash"] = *r.CodeHash
	}
	if r.Os != nil {
		body["os"] = r.Os
	}
	if r.Interfaces != nil {
		body["interfaces"] = r.Interfaces
	}

	return body
}

// LinkPath — путь канала постоянной связи с бэкендом (WebSocket).
const LinkPath = "/api/v1/wg-agent/link"

// LinkProtocol — версия протокола канала.
const LinkProtocol = 1

// LinkMessage — сообщение канала в обе стороны: поле Type и полезная
// нагрузка своего типа (остальные поля пусты).
type LinkMessage struct {
	Type string `json:"type"`

	// Агент → бэкенд.
	KnownVersion *int64         `json:"knownVersion,omitempty"`
	Report       map[string]any `json:"report,omitempty"`
	Stats        *StatsBody     `json:"stats,omitempty"`
	ID           string         `json:"id,omitempty"`
	Chunk        *string        `json:"chunk,omitempty"`
	ExitCode     *int           `json:"exitCode,omitempty"`
	Error        *string        `json:"error,omitempty"`

	// Бэкенд → агент.
	Protocol        int           `json:"protocol,omitempty"`
	StatsIntervalMs int           `json:"statsIntervalMs,omitempty"`
	State           *DesiredState `json:"state,omitempty"`
	AckSeq          *int64        `json:"seq,omitempty"`
	Message         string        `json:"message,omitempty"`
}
