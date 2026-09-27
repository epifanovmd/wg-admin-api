// Package backoff — задержка повтора после ошибки.
package backoff

import (
	"math"
	"math/rand/v2"
	"time"
)

const (
	baseMs = 1_000
	maxMs  = 60_000
)

// Delay — экспонента от 1 с до 60 с со случайным разбросом [50%, 100%]:
// агенты не приходят к поднявшемуся бэкенду разом.
func Delay(attempt int, random func() float64) time.Duration {
	if random == nil {
		random = rand.Float64
	}
	if attempt < 0 {
		attempt = 0
	}

	ceiling := math.Min(maxMs, baseMs*math.Pow(2, float64(attempt)))

	return time.Duration(math.Round(ceiling/2+ceiling/2*random())) * time.Millisecond
}
