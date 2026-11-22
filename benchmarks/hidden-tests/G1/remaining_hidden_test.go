package limiter

import (
	"testing"
	"time"
)

func TestHiddenRemaining(t *testing.T) {
	c := &FakeClock{T: time.Unix(0, 0)}
	b := NewWithClock(3, 1, c)
	if got := b.Remaining(); got != 3 {
		t.Fatalf("full bucket: got %v", got)
	}
	b.Allow()
	b.Allow()
	if got := b.Remaining(); got != 1 {
		t.Fatalf("after two: got %v", got)
	}
	c.Advance(time.Second)
	if got := b.Remaining(); got != 2 {
		t.Fatalf("after refill: got %v", got)
	}
}
