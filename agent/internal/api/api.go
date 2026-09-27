// Package api — HTTP-клиент протокола агента (ключ в X-Api-Key).
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"wgadmin/agent/internal/protocol"
)

// Client — клиент бэкенда.
type Client struct {
	base     string
	key      string
	pollWait time.Duration
	http     *http.Client
}

// New — клиент для адреса бэкенда и ключа агента.
func New(base, key string, pollWait time.Duration) *Client {
	return &Client{base: base, key: key, pollWait: pollWait, http: &http.Client{}}
}

func (c *Client) do(method, path string, query url.Values, body any, timeout time.Duration) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)

	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			cancel()

			return nil, err
		}
		reader = bytes.NewReader(data)
	}

	target := c.base + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		cancel()

		return nil, err
	}
	req.Header.Set("X-Api-Key", c.key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		cancel()

		return nil, err
	}
	if resp.StatusCode >= 300 {
		defer cancel()
		defer resp.Body.Close()

		text, _ := io.ReadAll(io.LimitReader(resp.Body, 300))

		return nil, fmt.Errorf("%s %s → %d: %s", method, path, resp.StatusCode, text)
	}

	resp.Body = cancelOnClose{ReadCloser: resp.Body, cancel: cancel}

	return resp, nil
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c cancelOnClose) Close() error {
	defer c.cancel()

	return c.ReadCloser.Close()
}

func (c *Client) post(path string, body any) error {
	resp, err := c.do(http.MethodPost, path, nil, body, 15*time.Second)
	if err != nil {
		return err
	}

	return resp.Body.Close()
}

// FetchState — long-poll желаемого состояния.
func (c *Client) FetchState(knownVersion int64) (protocol.DesiredState, error) {
	query := url.Values{}
	query.Set("knownVersion", strconv.FormatInt(knownVersion, 10))
	query.Set("waitMs", strconv.FormatInt(c.pollWait.Milliseconds(), 10))

	// Держим соединение дольше long-poll сервера.
	resp, err := c.do(http.MethodGet, "/api/v1/wg-agent/state", query, nil, c.pollWait+15*time.Second)
	if err != nil {
		return protocol.DesiredState{}, err
	}
	defer resp.Body.Close()

	var state protocol.DesiredState
	if err := json.NewDecoder(resp.Body).Decode(&state); err != nil {
		return protocol.DesiredState{}, fmt.Errorf("desired state: %w", err)
	}

	return state, nil
}

// Report — отчёт о применении.
func (c *Client) Report(report protocol.Report) error {
	return c.post("/api/v1/wg-agent/state", report.Body())
}

// Stats — статистика.
func (c *Client) Stats(body protocol.StatsBody) error {
	if body.Interfaces == nil {
		body.Interfaces = []protocol.InterfaceStats{}
	}

	return c.post("/api/v1/wg-agent/stats", body)
}

// AckCommand — команда принята.
func (c *Client) AckCommand(id string) error {
	return c.post("/api/v1/wg-agent/commands/"+id+"/ack", map[string]any{})
}

// CommandOutput — порция вывода команды.
func (c *Client) CommandOutput(id, chunk string) error {
	return c.post("/api/v1/wg-agent/commands/"+id+"/output", map[string]any{"chunk": chunk})
}

// CompleteCommand — итог команды.
func (c *Client) CompleteCommand(id string, exitCode *int, errMessage *string) error {
	return c.post("/api/v1/wg-agent/commands/"+id+"/complete", map[string]any{"exitCode": exitCode, "error": errMessage})
}

// DownloadBinary — бинарь агента для архитектуры (поток; закрыть вызывающему)
// с пределом на всё скачивание.
func (c *Client) DownloadBinary(arch string, timeout time.Duration) (io.ReadCloser, error) {
	resp, err := c.do(http.MethodGet, "/api/v1/wg-agent/binary/"+arch, nil, nil, timeout)
	if err != nil {
		return nil, err
	}

	return resp.Body, nil
}
