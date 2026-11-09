//go:build linux || darwin

package main

import (
	"context"
	"sync"
)

// groupParallelism bounds concurrent groups per run. With 2 CPUs per runner
// and 2 global slots, the machine runs at most 12 runner CPUs.
const groupParallelism = 3

// schedule runs every job with at most limit in flight and returns results in
// job order. A failing job never stops the others: each runs to completion so
// passing groups can be certified and every failure reported. Jobs not yet
// started when ctx is cancelled receive the cancelled context and should
// return promptly.
func schedule[T any](ctx context.Context, limit int, jobs []func(context.Context) (T, error)) ([]T, []error) {
	results := make([]T, len(jobs))
	errs := make([]error, len(jobs))
	if limit < 1 {
		limit = 1
	}
	tokens := make(chan struct{}, limit)
	var wait sync.WaitGroup
	for i, job := range jobs {
		wait.Add(1)
		tokens <- struct{}{}
		go func() {
			defer wait.Done()
			defer func() { <-tokens }()
			results[i], errs[i] = job(ctx)
		}()
	}
	wait.Wait()
	return results, errs
}
