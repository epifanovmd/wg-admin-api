package link

import (
	"testing"

	"wgadmin/agent/internal/protocol"
)

func TestBufferNumbersAcksAndEvicts(t *testing.T) {
	buffer := NewBuffer(3)

	first := buffer.Add(protocol.StatsBody{})
	for i := 0; i < 3; i++ {
		buffer.Add(protocol.StatsBody{})
	}

	if first.Seq != 1 || first.BootID == "" || first.CollectedAt == 0 {
		t.Fatalf("тик без номера, запуска или момента сбора: %+v", first)
	}

	// Переполнение вытесняет самый старый тик.
	pending := buffer.Pending()
	if len(pending) != 3 || pending[0].Seq != 2 || pending[2].Seq != 4 {
		t.Fatalf("очередь после вытеснения: %+v", pending)
	}

	buffer.Ack(3)
	if pending := buffer.Pending(); len(pending) != 1 || pending[0].Seq != 4 {
		t.Fatalf("после подтверждения по 3: %+v", pending)
	}

	// Повторное и устаревшее подтверждение ничего не ломают.
	buffer.Ack(2)
	buffer.Ack(4)
	if buffer.Len() != 0 {
		t.Fatalf("буфер не пуст: %d", buffer.Len())
	}
}

func TestBufferBootIDsDiffer(t *testing.T) {
	if NewBuffer(1).bootID == NewBuffer(1).bootID {
		t.Fatal("запуски агента неотличимы")
	}
}
