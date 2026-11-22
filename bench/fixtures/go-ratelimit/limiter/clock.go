package limiter

import "time"

// Clock abstracts time so tests can control it.
type Clock interface {
	Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

// FakeClock is a manually advanced clock for tests.
type FakeClock struct{ T time.Time }

func (f *FakeClock) Now() time.Time          { return f.T }
func (f *FakeClock) Advance(d time.Duration) { f.T = f.T.Add(d) }
