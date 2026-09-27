package socks

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/hex"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/crypto/scrypt"

	"wgadmin/agent/internal/protocol"
)

type pair struct {
	cert    *x509.Certificate
	key     *ecdsa.PrivateKey
	certPem string
	keyPem  string
}

func issue(t *testing.T, cn string, parent *pair, isCA bool, usage x509.ExtKeyUsage) *pair {
	t.Helper()

	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		BasicConstraintsValid: true,
		IsCA:                  isCA,
		DNSNames:              []string{cn},
	}
	if isCA {
		template.KeyUsage = x509.KeyUsageCertSign
	} else {
		template.ExtKeyUsage = []x509.ExtKeyUsage{usage}
	}

	signer, signerKey := template, key
	if parent != nil {
		signer, signerKey = parent.cert, parent.key
	}

	der, err := x509.CreateCertificate(rand.Reader, template, signer, &key.PublicKey, signerKey)
	if err != nil {
		t.Fatal(err)
	}

	cert, _ := x509.ParseCertificate(der)
	keyDer, _ := x509.MarshalPKCS8PrivateKey(key)

	return &pair{
		cert:    cert,
		key:     key,
		certPem: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		keyPem:  string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDer})),
	}
}

type fixture struct {
	ca, server, client, stranger *pair
	config                       protocol.Socks
	proxies                      *Proxies
	addr                         string
	echo                         net.Listener
}

func setup(t *testing.T) *fixture {
	t.Helper()

	f := &fixture{}
	f.ca = issue(t, "ca", nil, true, 0)
	f.server = issue(t, "server", f.ca, false, x509.ExtKeyUsageServerAuth)
	f.client = issue(t, "client", f.ca, false, x509.ExtKeyUsageClientAuth)
	otherCA := issue(t, "other-ca", nil, true, 0)
	f.stranger = issue(t, "stranger", otherCA, false, x509.ExtKeyUsageClientAuth)

	salt := []byte("0123456789abcdef")
	hash, _ := scrypt.Key([]byte("secret-pass"), salt, scryptN, scryptR, scryptP, scryptKeyLen)

	f.config = protocol.Socks{
		ID: "s1", ListenPort: 1, CertPem: f.server.certPem, KeyPem: f.server.keyPem, CaPem: f.ca.certPem,
		AllowedFingerprints: []string{Fingerprint(f.client.cert.Raw)},
		Users:               []protocol.SocksUser{{Username: "tg", Salt: hex.EncodeToString(salt), Hash: hex.EncodeToString(hash)}},
	}

	var err error
	f.echo, err = net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			conn, err := f.echo.Accept()
			if err != nil {
				return
			}
			go func() { _, _ = io.Copy(conn, conn) }()
		}
	}()

	f.proxies = New()
	f.proxies.Listen = func(int) (net.Listener, error) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err == nil {
			f.addr = listener.Addr().String()
		}
		return listener, err
	}
	if errs := f.proxies.Apply([]protocol.Socks{f.config}); len(errs) != 0 {
		t.Fatal(errs)
	}

	t.Cleanup(func() {
		f.proxies.CloseAll()
		_ = f.echo.Close()
	})

	return f
}

func (f *fixture) dial(t *testing.T, client *pair) *tls.Conn {
	t.Helper()

	pool := x509.NewCertPool()
	pool.AddCert(f.ca.cert)

	cert, _ := tls.X509KeyPair([]byte(client.certPem), []byte(client.keyPem))
	conn, err := tls.Dial("tcp", f.addr, &tls.Config{Certificates: []tls.Certificate{cert}, RootCAs: pool, ServerName: "server"})
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	return conn
}

func read(conn net.Conn, size int) []byte {
	buf := make([]byte, size)
	if _, err := io.ReadFull(conn, buf); err != nil {
		return nil
	}
	return buf
}

// open — приветствие, логин и CONNECT к echo-серверу.
func (f *fixture) open(t *testing.T, password string) (*tls.Conn, []byte, []byte) {
	conn := f.dial(t, f.client)
	_, _ = conn.Write([]byte{0x05, 0x01, 0x02})
	if got := read(conn, 2); string(got) != "\x05\x02" {
		t.Fatalf("метод: %v", got)
	}

	auth := append([]byte{0x01, 2}, "tg"...)
	auth = append(auth, byte(len(password)))
	auth = append(auth, password...)
	_, _ = conn.Write(auth)

	authReply := read(conn, 2)
	if authReply == nil || authReply[1] != 0x00 {
		return conn, authReply, nil
	}

	_, port, _ := net.SplitHostPort(f.echo.Addr().String())
	portNum := make([]byte, 2)
	var p int
	for _, c := range port {
		p = p*10 + int(c-'0')
	}
	binary.BigEndian.PutUint16(portNum, uint16(p))
	_, _ = conn.Write(append([]byte{0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1}, portNum...))

	return conn, authReply, read(conn, 10)
}

func TestConnectAndCount(t *testing.T) {
	f := setup(t)
	conn, _, connectReply := f.open(t, "secret-pass")
	defer conn.Close()

	if connectReply == nil || connectReply[1] != replyOK {
		t.Fatalf("CONNECT: %v", connectReply)
	}
	_, _ = conn.Write([]byte("hello"))
	if got := read(conn, 5); string(got) != "hello" {
		t.Fatalf("эхо: %q", got)
	}

	stats := f.proxies.Stats()[0]
	if stats.Connections != 1 || stats.RxBytes < 5 || stats.TxBytes < 5 {
		t.Fatalf("%+v", stats)
	}
}

func TestWrongPassword(t *testing.T) {
	f := setup(t)
	conn, authReply, _ := f.open(t, "wrong-pass")
	defer conn.Close()

	if string(authReply) != "\x01\x01" {
		t.Fatalf("%v", authReply)
	}
	if read(conn, 1) != nil {
		t.Fatal("после отказа соединение закрывается")
	}
}

func TestStrangerCertificate(t *testing.T) {
	f := setup(t)

	pool := x509.NewCertPool()
	pool.AddCert(f.ca.cert)
	cert, _ := tls.X509KeyPair([]byte(f.stranger.certPem), []byte(f.stranger.keyPem))
	conn, err := tls.Dial("tcp", f.addr, &tls.Config{Certificates: []tls.Certificate{cert}, RootCAs: pool, ServerName: "server"})
	if err != nil {
		return
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	_, _ = conn.Write([]byte{0x05, 0x01, 0x02})

	if read(conn, 2) != nil {
		t.Fatal("чужой CA не должен пройти")
	}
}

func TestRevokeDropsConnection(t *testing.T) {
	f := setup(t)
	conn, _, connectReply := f.open(t, "secret-pass")
	defer conn.Close()

	if connectReply == nil || connectReply[1] != replyOK {
		t.Fatal("соединение до отзыва")
	}

	revoked := f.config
	revoked.AllowedFingerprints = []string{}
	f.proxies.Apply([]protocol.Socks{revoked})

	if read(conn, 1) != nil {
		t.Fatal("отозванный клиент теряет соединение сразу")
	}
}

func TestBusyPort(t *testing.T) {
	busy, _ := net.Listen("tcp", "127.0.0.1:0")
	defer busy.Close()

	proxies := New()
	proxies.Listen = func(int) (net.Listener, error) { return net.Listen("tcp", busy.Addr().String()) }
	f := setup(t)

	errs := proxies.Apply([]protocol.Socks{f.config})
	if len(errs) != 1 || !strings.Contains(errs[0], "address already in use") {
		t.Fatalf("%v", errs)
	}
}

func TestReplyForError(t *testing.T) {
	if ReplyForError(syscall.ECONNREFUSED) != replyRefused {
		t.Fatal("refused")
	}
	if ReplyForError(&net.DNSError{Err: "no such host", Name: "x"}) != replyHostUnreachable {
		t.Fatal("dns")
	}
	if ReplyForError(io.EOF) != replyFailure {
		t.Fatal("прочее")
	}
}
