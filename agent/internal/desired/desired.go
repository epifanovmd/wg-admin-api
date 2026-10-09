// Package desired — настройки воркера wg от бэкенда (ключи state и probes) и
// итоги их применения. Поля совпадают с типами бэкенда: менять синхронно.
package desired

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

// State — желаемое состояние ноды (настройка state).
type State struct {
	// Version — версия конфигурации ноды на бэкенде.
	Version    int64       `json:"version"`
	NodeID     string      `json:"nodeId"`
	NodeName   string      `json:"nodeName"`
	Interfaces []Interface `json:"interfaces"`
	Tunnels    []Tunnel    `json:"tunnels"`
	Forwards   []Forward   `json:"forwards"`
}

// ProbeTarget — нода для проверки связности.
type ProbeTarget struct {
	NodeID string `json:"nodeId"`
	Host   string `json:"host"`
}

// Probes — цели проверки связности (настройка probes).
type Probes struct {
	Targets []ProbeTarget `json:"targets"`
}

// InterfaceStatus — фактический статус интерфейса: up | down | error.
type InterfaceStatus struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

// ForwardStatus — активный маршрут проброса.
type ForwardStatus struct {
	ID              string `json:"id"`
	ActiveRoute     string `json:"activeRoute"`
	ActiveCandidate *int   `json:"activeCandidate,omitempty"`
	ActiveNodeID    string `json:"activeNodeId,omitempty"`
}

// StateResult — итог применения state: ответ на PUT /config/state и
// событие state.result.
type StateResult struct {
	Version    int64             `json:"version"`
	AppliedAt  int64             `json:"appliedAt"`
	Interfaces []InterfaceStatus `json:"interfaces"`
	Routes     []ForwardStatus   `json:"routes"`
	Errors     []string          `json:"errors"`
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
