package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/epifanovmd/agent/protocol"

	"wgadmin/agent/internal/socks"
)

// selfSigned — сертификат и ключ PEM (он же CA для проверки).
func selfSigned(t *testing.T) (string, string) {
	t.Helper()

	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "proxy.example.com"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDer, _ := x509.MarshalPKCS8PrivateKey(key)

	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDer}))
}

func TestProxiesConfig(t *testing.T) {
	busy, _ := net.Listen("tcp", "127.0.0.1:0")
	defer busy.Close()

	proxies := socks.New()
	proxies.Listen = func(port int) (net.Listener, error) {
		if port == 2 {
			return net.Listen("tcp", busy.Addr().String())
		}

		return net.Listen("tcp", "127.0.0.1:0")
	}
	service := NewService(proxies)
	defer service.Close()
	ctx := context.Background()

	cert, key := selfSigned(t)
	proxy := func(id string, port int) map[string]any {
		return map[string]any{"id": id, "listenPort": port, "certPem": cert, "keyPem": key, "caPem": cert, "allowedFingerprints": []string{}, "users": []any{}}
	}
	data, _ := json.Marshal(map[string]any{"proxies": []any{proxy("p1", 1), proxy("p2", 2)}})

	// Прокси с занятым портом — не отказ в настройке: он в пульсе.
	if err := service.Configure(ctx, ConfigProxies, data); err != nil {
		t.Fatal(err)
	}
	health := service.Health()
	if health.OK || !strings.HasPrefix(health.Message, "p2: ") {
		t.Fatalf("%+v", health)
	}
	var metrics struct {
		Proxies []struct {
			ID          string `json:"id"`
			Connections int    `json:"connections"`
		} `json:"proxies"`
	}
	if err := json.Unmarshal(health.Metrics, &metrics); err != nil || len(metrics.Proxies) != 1 || metrics.Proxies[0].ID != "p1" {
		t.Fatalf("%s %v", health.Metrics, err)
	}

	var ei *protocol.ErrorInfo
	if err := service.Configure(ctx, ConfigProxies, json.RawMessage(`"строка"`)); !errors.As(err, &ei) || ei.Code != protocol.CodeConfigRejected {
		t.Fatalf("неверное значение: %v", err)
	}
	if err := service.Configure(ctx, "nope", data); !errors.As(err, &ei) {
		t.Fatalf("чужой ключ: %v", err)
	}

	// Ключ удалён — прокси закрыты, пульс в порядке.
	if err := service.Configure(ctx, ConfigProxies, nil); err != nil {
		t.Fatal(err)
	}
	if health := service.Health(); !health.OK || string(health.Metrics) != `{"proxies":[]}` {
		t.Fatalf("%+v %s", health, health.Metrics)
	}

	if manifest := Manifest(); len(manifest.Configs) != 1 || manifest.Configs[0].Key != ConfigProxies {
		t.Fatalf("%+v", manifest)
	}
}
