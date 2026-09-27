package link

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"wgadmin/agent/internal/protocol"
)

// Buffer — тики статистики, ещё не подтверждённые бэкендом: при разрыве связи
// они досылаются по порядку, и история на бэкенде остаётся без дыр. Тик
// получает номер в рамках запуска агента и момент сбора; самые старые тики
// вытесняются при переполнении.
type Buffer struct {
	mu      sync.Mutex
	bootID  string
	next    int64
	max     int
	entries []protocol.StatsBody
	now     func() time.Time
}

// NewBuffer — буфер на max тиков с новым идентификатором запуска.
func NewBuffer(max int) *Buffer {
	raw := make([]byte, 8)
	_, _ = rand.Read(raw)

	return &Buffer{bootID: hex.EncodeToString(raw), max: max, now: time.Now}
}

// Add — тик с номером и моментом сбора; возвращается копия для отправки.
func (b *Buffer) Add(body protocol.StatsBody) protocol.StatsBody {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.next++
	body.Seq = b.next
	body.BootID = b.bootID
	body.CollectedAt = b.now().UnixMilli()

	b.entries = append(b.entries, body)
	if len(b.entries) > b.max {
		b.entries = append([]protocol.StatsBody(nil), b.entries[len(b.entries)-b.max:]...)
	}

	return body
}

// Pending — неподтверждённые тики от старых к новым.
func (b *Buffer) Pending() []protocol.StatsBody {
	b.mu.Lock()
	defer b.mu.Unlock()

	return append([]protocol.StatsBody(nil), b.entries...)
}

// Ack — бэкенд принял тики по номер seq включительно.
func (b *Buffer) Ack(seq int64) {
	b.mu.Lock()
	defer b.mu.Unlock()

	keep := 0
	for keep < len(b.entries) && b.entries[keep].Seq <= seq {
		keep++
	}
	b.entries = append([]protocol.StatsBody(nil), b.entries[keep:]...)
}

// Len — сколько тиков ждут подтверждения.
func (b *Buffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()

	return len(b.entries)
}
