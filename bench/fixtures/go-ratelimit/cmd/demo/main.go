package main

import (
	"fmt"

	"example.com/ratelimit/limiter"
)

func main() {
	r := limiter.NewRegistry(3, 1, nil)
	for i := 0; i < 5; i++ {
		fmt.Println("request", i, "allowed:", r.Allow("client-1"))
	}
}
