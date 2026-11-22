package limiter

import "sync"

// Registry keeps one bucket per key (e.g. per client IP).
type Registry struct {
	mu       sync.Mutex
	buckets  map[string]*TokenBucket
	capacity float64
	rate     float64
	clock    Clock
}

func NewRegistry(capacity, rate float64, clock Clock) *Registry {
	if clock == nil {
		clock = realClock{}
	}
	return &Registry{buckets: map[string]*TokenBucket{}, capacity: capacity, rate: rate, clock: clock}
}

// Allow reports whether key may perform one more event.
func (r *Registry) Allow(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.buckets[key]
	if !ok {
		b = NewWithClock(r.capacity, r.rate, r.clock)
		r.buckets[key] = b
	}
	return b.Allow()
}
