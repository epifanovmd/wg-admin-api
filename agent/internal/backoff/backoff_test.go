package backoff

import (
	"testing"
	"time"
)

func TestDelayGrowsAndCaps(t *testing.T) {
	half := func() float64 { return 0 }
	full := func() float64 { return 1 }

	if got := Delay(0, full); got != time.Second {
		t.Fatalf("attempt 0 full: %v", got)
	}
	if got := Delay(0, half); got != 500*time.Millisecond {
		t.Fatalf("attempt 0 half: %v", got)
	}
	if got := Delay(3, full); got != 8*time.Second {
		t.Fatalf("attempt 3: %v", got)
	}
	if got := Delay(20, full); got != 60*time.Second {
		t.Fatalf("cap: %v", got)
	}
	if got := Delay(-5, full); got != time.Second {
		t.Fatalf("negative: %v", got)
	}
}
