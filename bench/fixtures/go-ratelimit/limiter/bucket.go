package limiter

import "time"

// TokenBucket allows up to Capacity events at once and refills at Rate tokens per second.
type TokenBucket struct {
	Capacity float64
	Rate     float64
	tokens   float64
	last     time.Time
	clock    Clock
}

// New returns a full bucket.
func New(capacity, rate float64) *TokenBucket {
	return NewWithClock(capacity, rate, realClock{})
}

// NewWithClock returns a full bucket that reads time from clock.
func NewWithClock(capacity, rate float64, clock Clock) *TokenBucket {
	return &TokenBucket{Capacity: capacity, Rate: rate, tokens: capacity, last: clock.Now(), clock: clock}
}

func (b *TokenBucket) refill() {
	now := b.clock.Now()
	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * b.Rate
	b.last = now
}

// Allow consumes one token if available.
func (b *TokenBucket) Allow() bool {
	return b.AllowN(1)
}

// AllowN consumes n tokens if available.
func (b *TokenBucket) AllowN(n float64) bool {
	b.refill()
	if b.tokens >= n {
		b.tokens -= n
		return true
	}
	return false
}
