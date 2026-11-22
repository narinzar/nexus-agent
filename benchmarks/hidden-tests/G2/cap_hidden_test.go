package limiter

import (
	"testing"
	"time"
)

func TestHiddenNeverExceedsCapacity(t *testing.T) {
	c := &FakeClock{T: time.Unix(0, 0)}
	b := NewWithClock(2, 1, c)
	c.Advance(10 * time.Second)
	if !b.Allow() || !b.Allow() {
		t.Fatal("expected two tokens")
	}
	if b.Allow() {
		t.Fatal("bucket refilled above capacity after idle period")
	}
}
