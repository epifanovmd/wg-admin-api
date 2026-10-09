package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func call(t *testing.T, server *httptest.Server, method, path string, body any) (int, map[string]any) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, server.URL+path, reader)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var decoded map[string]any
	_ = json.NewDecoder(res.Body).Decode(&decoded)

	return res.StatusCode, decoded
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
	service := NewService(proxies, "1.0.0")
	server := httptest.NewServer(service.Handler())
	defer server.Close()
	defer service.Close()

	cert, key := selfSigned(t)
	proxy := func(id string, port int) map[string]any {
		return map[string]any{"id": id, "listenPort": port, "certPem": cert, "keyPem": key, "caPem": cert, "allowedFingerprints": []string{}, "users": []any{}}
	}

	status, result := call(t, server, "PUT", "/config/proxies", map[string]any{"version": 3, "data": map[string]any{"proxies": []any{proxy("p1", 1), proxy("p2", 2)}}})
	if status != 200 || result["version"] != float64(3) {
		t.Fatalf("%d %+v", status, result)
	}
	statuses := result["proxies"].([]any)
	if statuses[0].(map[string]any)["status"] != "listening" || statuses[1].(map[string]any)["status"] != "error" {
		t.Fatalf("%+v", statuses)
	}
	if errs := result["errors"].([]any); len(errs) != 1 || !strings.HasPrefix(errs[0].(string), "p2: ") {
		t.Fatalf("%+v", result)
	}

	_, metrics := call(t, server, "GET", "/metrics", nil)
	stats := metrics["proxies"].([]any)
	if len(stats) != 1 || stats[0].(map[string]any)["id"] != "p1" || stats[0].(map[string]any)["connections"] != float64(0) {
		t.Fatalf("%+v", metrics)
	}

	_, health := call(t, server, "GET", "/health", nil)
	if health["ok"] != true || len(health["info"].(map[string]any)["proxies"].([]any)) != 2 {
		t.Fatalf("%+v", health)
	}

	if status, manifest := call(t, server, "GET", "/manifest", nil); status != 200 || manifest["version"] != "1.0.0" || len(manifest["configs"].([]any)) != 1 {
		t.Fatalf("%+v", manifest)
	}

	if status, _ := call(t, server, "PUT", "/config/proxies", map[string]any{"version": 4}); status != 400 {
		t.Fatalf("нет data: %d", status)
	}

	if status, _ := call(t, server, "DELETE", "/config/proxies", nil); status != 204 {
		t.Fatal(status)
	}
	if _, metrics := call(t, server, "GET", "/metrics", nil); len(metrics["proxies"].([]any)) != 0 {
		t.Fatalf("%+v", metrics)
	}
	if status, _ := call(t, server, "POST", "/cleanup", nil); status != 204 {
		t.Fatal(status)
	}
	if status, _ := call(t, server, "GET", "/nope", nil); status != 404 {
		t.Fatal(status)
	}
}
