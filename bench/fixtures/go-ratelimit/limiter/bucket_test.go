package limiter

import (
	"testing"
	"time"
)

func TestAllowUntilEmpty(t *testing.T) {
	c := &FakeClock{T: time.Unix(0, 0)}
	b := NewWithClock(2, 1, c)
	if !b.Allow() || !b.Allow() {
		t.Fatal("expected two allowed events")
	}
	if b.Allow() {
		t.Fatal("expected bucket to be empty")
	}
	c.Advance(time.Second)
	if !b.Allow() {
		t.Fatal("expected refill after one second")
	}
}

func TestRegistrySeparatesKeys(t *testing.T) {
	r := NewRegistry(1, 0, &FakeClock{T: time.Unix(0, 0)})
	if !r.Allow("a") || !r.Allow("b") || r.Allow("a") {
		t.Fatal("buckets must be per key")
	}
}
