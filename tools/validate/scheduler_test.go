//go:build linux || darwin

package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestScheduleBoundsParallelismAndKeepsOrder(t *testing.T) {
	var active, peak atomic.Int32
	jobs := make([]func(context.Context) (int, error), 7)
	for i := range jobs {
		jobs[i] = func(context.Context) (int, error) {
			now := active.Add(1)
			for {
				old := peak.Load()
				if now <= old || peak.CompareAndSwap(old, now) {
					break
				}
			}
			time.Sleep(20 * time.Millisecond)
			active.Add(-1)
			return i * 10, nil
		}
	}
	results, errs := schedule(context.Background(), groupParallelism, jobs)
	if peak.Load() != groupParallelism {
		t.Fatalf("peak concurrency %d, want %d", peak.Load(), groupParallelism)
	}
	for i, value := range results {
		if value != i*10 || errs[i] != nil {
			t.Fatalf("job %d: %d, %v", i, value, errs[i])
		}
	}
}

func TestScheduleFinishesEveryGroupAfterFailure(t *testing.T) {
	var finished atomic.Int32
	failure := errors.New("frontend failed")
	jobs := []func(context.Context) (string, error){
		func(context.Context) (string, error) { finished.Add(1); return "frontend", failure },
		func(context.Context) (string, error) {
			time.Sleep(30 * time.Millisecond)
			finished.Add(1)
			return "docs", nil
		},
		func(context.Context) (string, error) { finished.Add(1); return "go", errors.New("go failed") },
		func(context.Context) (string, error) { finished.Add(1); return "tooling", nil },
	}
	results, errs := schedule(context.Background(), groupParallelism, jobs)
	if finished.Load() != 4 {
		t.Fatalf("%d of 4 groups finished", finished.Load())
	}
	if !errors.Is(errs[0], failure) || errs[1] != nil || errs[2] == nil || errs[3] != nil {
		t.Fatalf("errors not reported per group: %v", errs)
	}
	if results[1] != "docs" || results[3] != "tooling" {
		t.Fatalf("passing results lost: %v", results)
	}
}

func TestScheduleHandsCancellationToUnstartedJobs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	release := make(chan struct{})
	var started atomic.Int32
	jobs := make([]func(context.Context) (int, error), 4)
	for i := range jobs {
		jobs[i] = func(ctx context.Context) (int, error) {
			started.Add(1)
			if i == 0 {
				cancel()
				close(release)
			}
			<-release
			return 0, ctx.Err()
		}
	}
	_, errs := schedule(ctx, 1, jobs)
	for i, err := range errs {
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("job %d: %v", i, err)
		}
	}
}

func TestOnlyContainerGroupsNeedASlot(t *testing.T) {
	if needsSlot([]string{"repo", "web-static", "tooling-static", "site-static"}) {
		t.Fatal("host-only runs must not wait for machine capacity")
	}
	if !needsSlot([]string{"repo", "frontend"}) {
		t.Fatal("container groups require a slot")
	}
}
