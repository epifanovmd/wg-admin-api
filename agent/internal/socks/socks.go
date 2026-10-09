// Package socks — SOCKS5-прокси через mTLS: TLS только с клиентским
// сертификатом, выданным CA сервиса и не отозванным (allowlist отпечатков),
// затем логин и пароль (RFC 1929) и CONNECT. Изменения применяются на лету.
package socks

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/crypto/scrypt"

	"wgadmin/agent/internal/logx"
)

// User — пользователь прокси: только соль и scrypt-хэш (hex).
type User struct {
	Username string `json:"username"`
	Salt     string `json:"salt"`
	Hash     string `json:"hash"`
}

// Config — SOCKS5-прокси через mTLS.
type Config struct {
	ID                  string   `json:"id"`
	ListenPort          int      `json:"listenPort"`
	CertPem             string   `json:"certPem"`
	KeyPem              string   `json:"keyPem"`
	CaPem               string   `json:"caPem"`
	AllowedFingerprints []string `json:"allowedFingerprints"`
	Users               []User   `json:"users"`
}

// Status — итог применения прокси: listening | error.
type Status struct {
	ID         string `json:"id"`
	ListenPort int    `json:"listenPort"`
	Status     string `json:"status"`
	Message    string `json:"message,omitempty"`
}

// Stats — соединения и трафик прокси.
type Stats struct {
	ID          string `json:"id"`
	Connections int    `json:"connections"`
	RxBytes     int64  `json:"rxBytes"`
	TxBytes     int64  `json:"txBytes"`
}

// Параметры scrypt — как у бэкенда при хэшировании пароля.
const (
	scryptN      = 16384
	scryptR      = 8
	scryptP      = 1
	scryptKeyLen = 32

	handshakeTimeout = 15 * time.Second
	connectTimeout   = 10 * time.Second
	authCacheMax     = 1000
)

// Коды ответа SOCKS5 (RFC 1928, 6).
const (
	replyOK                  = 0x00
	replyFailure             = 0x01
	replyNetworkUnreachable  = 0x03
	replyHostUnreachable     = 0x04
	replyRefused             = 0x05
	replyTTLExpired          = 0x06
	replyCommandNotSupported = 0x07
	replyAddressNotSupported = 0x08
)

// Fingerprint — SHA-256 сертификата (hex, нижний регистр) — вид бэкенда.
func Fingerprint(raw []byte) string {
	sum := sha256.Sum256(raw)

	return hex.EncodeToString(sum[:])
}

// ReplyForError — ошибка подключения к цели → код ответа SOCKS5.
func ReplyForError(err error) byte {
	var dnsErr *net.DNSError

	switch {
	case errors.Is(err, syscall.ECONNREFUSED):
		return replyRefused
	case errors.Is(err, syscall.ENETUNREACH):
		return replyNetworkUnreachable
	case errors.Is(err, syscall.EHOSTUNREACH), errors.As(err, &dnsErr):
		return replyHostUnreachable
	case errors.Is(err, context.DeadlineExceeded), isTimeout(err):
		return replyTTLExpired
	default:
		return replyFailure
	}
}

func isTimeout(err error) bool {
	var netErr net.Error

	return errors.As(err, &netErr) && netErr.Timeout()
}

func reply(code byte) []byte {
	return []byte{0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0}
}

type connection struct {
	conn        net.Conn
	fingerprint string
	mu          sync.Mutex
	username    string
}

type proxy struct {
	mu          sync.RWMutex
	config      Config
	tlsConfig   *tls.Config
	listener    net.Listener
	connections map[*connection]struct{}
	rx          atomic.Int64
	tx          atomic.Int64
	wg          sync.WaitGroup
}

// Proxies — прокси воркера: одно на процесс, живёт между применениями.
type Proxies struct {
	mu        sync.Mutex
	proxies   map[string]*proxy
	authMu    sync.Mutex
	authCache map[string]struct{}
	// Listen — подменяется в тестах (адрес для слушателя).
	Listen func(port int) (net.Listener, error)
}

// New — пустой набор прокси.
func New() *Proxies {
	return &Proxies{
		proxies:   map[string]*proxy{},
		authCache: map[string]struct{}{},
		Listen: func(port int) (net.Listener, error) {
			return net.Listen("tcp", ":"+strconv.Itoa(port))
		},
	}
}

func buildTLS(config Config) (*tls.Config, error) {
	cert, err := tls.X509KeyPair([]byte(config.CertPem), []byte(config.KeyPem))
	if err != nil {
		return nil, fmt.Errorf("сертификат сервера: %w", err)
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(config.CaPem)) {
		return nil, errors.New("CA прокси не разобран")
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

func tlsMaterial(config Config) string {
	return config.CertPem + "\x00" + config.KeyPem + "\x00" + config.CaPem
}

// Apply приводит прокси к списку: новые слушают, удалённые и сменившие порт
// закрываются, у остальных сертификаты и доступы меняются без перезапуска
// слушателя. Итог — по каждому прокси списка, в его порядке.
func (p *Proxies) Apply(configs []Config) []Status {
	p.mu.Lock()
	defer p.mu.Unlock()

	failed := map[string]string{}

	wanted := map[string]Config{}
	for _, config := range configs {
		wanted[config.ID] = config
	}

	for id, current := range p.proxies {
		current.mu.RLock()
		port := current.config.ListenPort
		current.mu.RUnlock()

		if next, ok := wanted[id]; !ok || next.ListenPort != port {
			p.closeLocked(id)
		}
	}

	for _, config := range configs {
		current, ok := p.proxies[config.ID]
		if !ok {
			if err := p.startLocked(config); err != nil {
				failed[config.ID] = err.Error()
			}

			continue
		}

		current.mu.Lock()
		if tlsMaterial(current.config) != tlsMaterial(config) {
			if tlsConfig, err := buildTLS(config); err == nil {
				// Новые рукопожатия — с новыми сертификатами, слушатель тот же.
				current.tlsConfig = tlsConfig
			} else {
				// Сертификаты прежние (ими слушатель и работает), доступы —
				// новые: отзыв действует и при ошибке сертификата.
				failed[config.ID] = err.Error()
				config.CertPem, config.KeyPem, config.CaPem = current.config.CertPem, current.config.KeyPem, current.config.CaPem
			}
		}
		current.config = config
		current.mu.Unlock()
		current.dropRevoked()
	}

	statuses := make([]Status, 0, len(configs))
	for _, config := range configs {
		status := Status{ID: config.ID, ListenPort: config.ListenPort, Status: "listening"}
		if message, ok := failed[config.ID]; ok {
			status.Status = "error"
			status.Message = message
			logx.Error("Прокси :%d: %s", config.ListenPort, message)
		}
		statuses = append(statuses, status)
	}

	return statuses
}

// Stats — соединения и трафик по прокси.
func (p *Proxies) Stats() []Stats {
	p.mu.Lock()
	defer p.mu.Unlock()

	stats := []Stats{}
	for id, current := range p.proxies {
		current.mu.RLock()
		connections := len(current.connections)
		current.mu.RUnlock()

		stats = append(stats, Stats{ID: id, Connections: connections, RxBytes: current.rx.Load(), TxBytes: current.tx.Load()})
	}

	return stats
}

// CloseAll — остановить все прокси.
func (p *Proxies) CloseAll() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for id := range p.proxies {
		p.closeLocked(id)
	}
}

func (p *Proxies) startLocked(config Config) error {
	tlsConfig, err := buildTLS(config)
	if err != nil {
		return err
	}

	listener, err := p.Listen(config.ListenPort)
	if err != nil {
		return err
	}

	current := &proxy{config: config, tlsConfig: tlsConfig, listener: listener, connections: map[*connection]struct{}{}}
	p.proxies[config.ID] = current

	go p.serve(current)
	logx.Info("Прокси SOCKS5 (mTLS) слушает :%d", config.ListenPort)

	return nil
}

func (p *Proxies) closeLocked(id string) {
	current, ok := p.proxies[id]
	if !ok {
		return
	}

	delete(p.proxies, id)
	_ = current.listener.Close()

	current.mu.Lock()
	for conn := range current.connections {
		_ = conn.conn.Close()
	}
	port := current.config.ListenPort
	current.mu.Unlock()

	logx.Info("Прокси :%d остановлен", port)
}

func (p *Proxies) serve(current *proxy) {
	for {
		raw, err := current.listener.Accept()
		if err != nil {
			return
		}

		go p.handle(current, raw)
	}
}

// dropRevoked закрывает соединения отозванных клиентов и выключенных
// пользователей.
func (current *proxy) dropRevoked() {
	current.mu.RLock()
	defer current.mu.RUnlock()

	allowed := map[string]bool{}
	for _, fp := range current.config.AllowedFingerprints {
		allowed[fp] = true
	}

	users := map[string]bool{}
	for _, user := range current.config.Users {
		users[user.Username] = true
	}

	for conn := range current.connections {
		conn.mu.Lock()
		username := conn.username
		conn.mu.Unlock()

		if !allowed[conn.fingerprint] || (username != "" && !users[username]) {
			_ = conn.conn.Close()
		}
	}
}

func (p *Proxies) verify(config Config, username, password string) bool {
	var user *User

	for i := range config.Users {
		if config.Users[i].Username == username {
			user = &config.Users[i]
		}
	}
	if user == nil {
		return false
	}

	sum := sha256.Sum256([]byte(user.Salt + "\x00" + user.Hash + "\x00" + password))
	cacheKey := hex.EncodeToString(sum[:])

	p.authMu.Lock()
	_, cached := p.authCache[cacheKey]
	p.authMu.Unlock()
	if cached {
		return true
	}

	salt, errSalt := hex.DecodeString(user.Salt)
	expected, errHash := hex.DecodeString(user.Hash)
	if errSalt != nil || errHash != nil {
		return false
	}

	actual, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil || subtle.ConstantTimeCompare(expected, actual) != 1 {
		return false
	}

	p.authMu.Lock()
	if len(p.authCache) >= authCacheMax {
		p.authCache = map[string]struct{}{}
	}
	p.authCache[cacheKey] = struct{}{}
	p.authMu.Unlock()

	return true
}

func readFull(conn net.Conn, size int) ([]byte, error) {
	buf := make([]byte, size)
	_, err := io.ReadFull(conn, buf)

	return buf, err
}

// ReadTarget читает адрес назначения CONNECT: IPv4, домен или IPv6.
func ReadTarget(conn net.Conn, atyp byte) (string, error) {
	var host string

	switch atyp {
	case 0x01:
		raw, err := readFull(conn, 4)
		if err != nil {
			return "", err
		}
		host = net.IP(raw).String()
	case 0x03:
		length, err := readFull(conn, 1)
		if err != nil {
			return "", err
		}
		raw, err := readFull(conn, int(length[0]))
		if err != nil {
			return "", err
		}
		host = string(raw)
	case 0x04:
		raw, err := readFull(conn, 16)
		if err != nil {
			return "", err
		}
		host = net.IP(raw).String()
	default:
		return "", errors.New("unsupported address")
	}

	port, err := readFull(conn, 2)
	if err != nil {
		return "", err
	}

	return net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(port)))), nil
}

func (p *Proxies) handle(current *proxy, raw net.Conn) {
	defer raw.Close()

	current.mu.RLock()
	tlsConfig := current.tlsConfig
	current.mu.RUnlock()

	conn := tls.Server(raw, tlsConfig)
	_ = conn.SetDeadline(time.Now().Add(handshakeTimeout))

	if err := conn.Handshake(); err != nil {
		return
	}

	peer := conn.ConnectionState().PeerCertificates
	if len(peer) == 0 {
		return
	}

	current.mu.RLock()
	config := current.config
	current.mu.RUnlock()

	fingerprint := Fingerprint(peer[0].Raw)
	allowed := false
	for _, fp := range config.AllowedFingerprints {
		if fp == fingerprint {
			allowed = true
		}
	}
	if !allowed {
		return
	}

	tracked := &connection{conn: conn, fingerprint: fingerprint}

	current.mu.Lock()
	current.connections[tracked] = struct{}{}
	current.mu.Unlock()

	defer func() {
		current.mu.Lock()
		delete(current.connections, tracked)
		current.mu.Unlock()
	}()

	upstream, ok := p.negotiate(current, conn, tracked)
	if !ok {
		return
	}
	defer upstream.Close()

	_ = conn.SetDeadline(time.Time{})
	pipe(current, conn, upstream)
}

// negotiate — приветствие, RFC 1929 и CONNECT; возвращает соединение с целью.
func (p *Proxies) negotiate(current *proxy, conn *tls.Conn, tracked *connection) (net.Conn, bool) {
	head, err := readFull(conn, 2)
	if err != nil {
		return nil, false
	}

	methods, err := readFull(conn, int(head[1]))
	if err != nil {
		return nil, false
	}
	if head[0] != 0x05 || !strings.ContainsRune(string(methods), 0x02) {
		_, _ = conn.Write([]byte{0x05, 0xff})

		return nil, false
	}
	_, _ = conn.Write([]byte{0x05, 0x02})

	auth, err := readFull(conn, 2)
	if err != nil {
		return nil, false
	}
	username, err := readFull(conn, int(auth[1]))
	if err != nil {
		return nil, false
	}
	passwordLength, err := readFull(conn, 1)
	if err != nil {
		return nil, false
	}
	password, err := readFull(conn, int(passwordLength[0]))
	if err != nil {
		return nil, false
	}

	current.mu.RLock()
	config := current.config
	current.mu.RUnlock()

	if auth[0] != 0x01 || !p.verify(config, string(username), string(password)) {
		_, _ = conn.Write([]byte{0x01, 0x01})

		return nil, false
	}

	tracked.mu.Lock()
	tracked.username = string(username)
	tracked.mu.Unlock()
	_, _ = conn.Write([]byte{0x01, 0x00})

	request, err := readFull(conn, 4)
	if err != nil {
		return nil, false
	}

	target, err := ReadTarget(conn, request[3])
	if request[0] != 0x05 || err != nil {
		_, _ = conn.Write(reply(replyAddressNotSupported))

		return nil, false
	}
	if request[1] != 0x01 {
		_, _ = conn.Write(reply(replyCommandNotSupported))

		return nil, false
	}

	upstream, err := net.DialTimeout("tcp", target, connectTimeout)
	if err != nil {
		_, _ = conn.Write(reply(ReplyForError(err)))

		return nil, false
	}
	if tcp, ok := upstream.(*net.TCPConn); ok {
		_ = tcp.SetNoDelay(true)
	}

	_, _ = conn.Write(reply(replyOK))

	return upstream, true
}

type counter struct {
	total *atomic.Int64
}

func (c counter) Write(b []byte) (int, error) {
	c.total.Add(int64(len(b)))

	return len(b), nil
}

// pipe — двунаправленная пересылка с подсчётом байтов; закрытие одной
// стороны закрывает другую.
func pipe(current *proxy, client net.Conn, upstream net.Conn) {
	done := make(chan struct{}, 2)

	go func() {
		_, _ = io.Copy(io.MultiWriter(upstream, counter{&current.rx}), client)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(io.MultiWriter(client, counter{&current.tx}), upstream)
		done <- struct{}{}
	}()

	<-done
	_ = client.Close()
	_ = upstream.Close()
	<-done
}
