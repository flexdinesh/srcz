package feedback

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// testService is a service over a fresh directory whose clock advances a
// minute per call.
func testService(t *testing.T) (*Service, string) {
	t.Helper()
	directory := filepath.Join(t.TempDir(), "feedback")
	service := NewService(NewStore(directory))
	clock := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	service.now = func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		clock = clock.Add(time.Minute)
		return clock
	}
	return service, directory
}

func lineAnchor(path string, start, end int) Anchor {
	return Anchor{Path: path, Side: SideNew, Lines: &Lines{start, end}, Text: []string{"x"}}
}

func TestDefaultDirectory(t *testing.T) {
	home := func() (string, error) { return "/home/u", nil }
	config := func() (string, error) { return "/config", nil }
	env := func(values map[string]string) func(string) string {
		return func(name string) string { return values[name] }
	}
	for _, test := range []struct {
		goos string
		env  map[string]string
		want string
	}{
		{"linux", nil, "/home/u/.local/state/zero/feedback"},
		{"linux", map[string]string{"XDG_STATE_HOME": "/state"}, "/state/zero/feedback"},
		{"linux", map[string]string{"XDG_STATE_HOME": "relative"}, "/home/u/.local/state/zero/feedback"},
		{"darwin", map[string]string{"XDG_STATE_HOME": "/state"}, "/home/u/Library/Application Support/zero/feedback"},
		{"windows", nil, "/config/zero/feedback"},
	} {
		got, err := defaultDirectory(test.goos, env(test.env), home, config)
		if err != nil || got != test.want {
			t.Errorf("defaultDirectory(%s, %v) = %q, %v; want %q", test.goos, test.env, got, err, test.want)
		}
	}
}

func TestAddThreadCreatesOneStableIDPerBranch(t *testing.T) {
	service, directory := testService(t)
	target := Target{Repository: "/repo/.git", Branch: "topic", Project: "/repo"}
	first, thread, err := service.AddThread(target, NewThread{Anchor: lineAnchor("a.go", 1, 1), Author: AuthorUser, Body: "one"})
	if err != nil {
		t.Fatal(err)
	}
	if !ValidID(first.ID) || thread.Number != 1 || thread.Status != StatusOpen || len(thread.Messages) != 1 || thread.Messages[0].Number != 1 {
		t.Fatalf("first thread = %+v in %+v", thread, first)
	}
	second, thread, err := service.AddThread(target, NewThread{Anchor: lineAnchor("b.go", 2, 3), Author: AuthorAgent, Name: "claude", Body: "two"})
	if err != nil || second.ID != first.ID || thread.Number != 2 || len(second.Threads) != 2 {
		t.Fatalf("second thread = %+v, %v; want thread 2 of %s", thread, err, first.ID)
	}
	other, _, err := service.AddThread(Target{Repository: "/repo/.git", Branch: "main", Project: "/repo"}, NewThread{Anchor: lineAnchor("a.go", 1, 1), Author: AuthorUser, Body: "main"})
	if err != nil || other.ID == first.ID {
		t.Fatalf("another branch = %s, %v; want a new ID", other.ID, err)
	}
	if found, err := service.Find("/repo/.git", "topic"); err != nil || found.ID != first.ID {
		t.Errorf("Find = %s, %v", found.ID, err)
	}
	if _, err := service.Find("/repo/.git", "gone"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Find of a branch without feedback = %v", err)
	}
	if located, err := service.Locate(first.ID); err != nil || located.Branch != "topic" || located.Project != "/repo" {
		t.Errorf("Locate = %+v, %v", located, err)
	}
	if _, err := service.Get("/other/.git", first.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get from another repository = %v, want ErrNotFound", err)
	}

	// Private files, one directory per repository.
	repository := filepath.Dir(service.store.file("/repo/.git", first.ID))
	for name, want := range map[string]os.FileMode{directory: 0o700, repository: 0o700, service.store.file("/repo/.git", first.ID): 0o600} {
		info, err := os.Stat(name)
		if err != nil || info.Mode().Perm() != want {
			t.Errorf("%s mode = %v, %v; want %v", name, info.Mode().Perm(), err, want)
		}
	}

	summaries, err := service.List("/repo/.git")
	if err != nil || len(summaries) != 2 || summaries[0].ID != other.ID || summaries[1].Threads != 2 || summaries[1].AwaitingAgent != 1 || summaries[1].AwaitingUser != 1 || summaries[1].Open != 2 {
		t.Errorf("List = %+v, %v; want main first, then topic's counts", summaries, err)
	}
}

func TestAddThreadToAnExplicitID(t *testing.T) {
	service, _ := testService(t)
	created, _, err := service.AddThread(Target{Repository: "r", Branch: "topic", Project: "/p"}, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "one"})
	if err != nil {
		t.Fatal(err)
	}
	stored, thread, err := service.AddThread(Target{Repository: "r", Branch: "ignored", ID: created.ID, Project: "/p"}, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "two"})
	if err != nil || stored.Branch != "topic" || thread.Number != 2 {
		t.Errorf("AddThread by ID = %+v, %+v, %v", stored, thread, err)
	}
	if _, _, err := service.AddThread(Target{Repository: "r", ID: "fb-zzzzzz"}, NewThread{Author: AuthorUser, Body: "x"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("AddThread to an unknown ID = %v", err)
	}
}

func TestAddMessageAppliesStatuses(t *testing.T) {
	service, _ := testService(t)
	created, _, err := service.AddThread(Target{Repository: "r", Branch: "b", Project: "/p"}, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "fix"})
	if err != nil {
		t.Fatal(err)
	}
	steps := []struct {
		message       NewMessage
		status        string
		messageStatus string
		awaiting      string
	}{
		{NewMessage{Author: AuthorAgent, Name: "claude", Body: "why?"}, StatusOpen, "", AwaitingUser},
		{NewMessage{Author: AuthorUser, Body: "because"}, StatusOpen, "", AwaitingAgent},
		{NewMessage{Author: AuthorAgent, Body: "done", Status: StatusResolved}, StatusResolved, StatusResolved, AwaitingUser},
		{NewMessage{Author: AuthorAgent, Body: "also this"}, StatusResolved, "", AwaitingUser},
		{NewMessage{Author: AuthorUser, Body: "not quite"}, StatusOpen, StatusOpen, AwaitingAgent},
		{NewMessage{Author: AuthorUser, Status: StatusWontfix}, StatusWontfix, StatusWontfix, AwaitingNone},
		{NewMessage{Author: AuthorAgent, Status: StatusOpen}, StatusOpen, StatusOpen, AwaitingUser},
	}
	for i, step := range steps {
		step.message.Thread = 1
		_, thread, err := service.AddMessage("r", created.ID, "/p", step.message)
		last := thread.Messages[len(thread.Messages)-1]
		if err != nil || thread.Status != step.status || last.Status != step.messageStatus || last.Number != i+2 || thread.Awaiting() != step.awaiting {
			t.Errorf("step %d: thread %s awaiting %s, message %d status %q, %v; want %s awaiting %s, status %q", i, thread.Status, thread.Awaiting(), last.Number, last.Status, err, step.status, step.awaiting, step.messageStatus)
		}
	}
	if _, _, err := service.AddMessage("r", created.ID, "/p", NewMessage{Thread: 9, Author: AuthorUser, Body: "?"}); err == nil || err.Error() != fmt.Sprintf("invalid feedback: thread: feedback %s has no thread 9", created.ID) {
		t.Errorf("a missing thread = %v", err)
	}
	if _, _, err := service.AddMessage("r", "fb-zzzzzz", "/p", NewMessage{Thread: 1, Author: AuthorUser, Body: "?"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("a missing feedback = %v", err)
	}
}

func TestDeleteThreadNeverReusesNumbers(t *testing.T) {
	service, _ := testService(t)
	target := Target{Repository: "r", Branch: "b", Project: "/p"}
	created, _, _ := service.AddThread(target, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "1"})
	_, _, _ = service.AddThread(target, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "2"})
	stored, err := service.DeleteThread("r", created.ID, 2)
	if err != nil || len(stored.Threads) != 1 {
		t.Fatalf("DeleteThread = %+v, %v", stored, err)
	}
	if _, err := service.DeleteThread("r", created.ID, 2); err == nil {
		t.Error("deleting a deleted thread succeeded")
	}
	if _, thread, err := service.AddThread(target, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "3"}); err != nil || thread.Number != 3 {
		t.Errorf("next thread = %d, %v; want 3", thread.Number, err)
	}
	if err := service.Delete("r", created.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.Delete("r", created.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second Delete = %v", err)
	}
	if _, thread, err := service.AddThread(target, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "again"}); err != nil || thread.Number != 1 {
		t.Errorf("thread after deleting the feedback = %d, %v; want 1 in new feedback", thread.Number, err)
	}
}

func TestLimits(t *testing.T) {
	service, _ := testService(t)
	target := Target{Repository: "r", Branch: "b", Project: "/p"}
	created, _, _ := service.AddThread(target, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "1"})
	for range MaxMessages - 1 {
		if _, _, err := service.AddMessage("r", created.ID, "/p", NewMessage{Thread: 1, Author: AuthorAgent, Body: "m"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := service.AddMessage("r", created.ID, "/p", NewMessage{Thread: 1, Author: AuthorAgent, Body: "m"}); !errors.Is(err, ErrFull) {
		t.Errorf("message %d = %v, want ErrFull", MaxMessages+1, err)
	}
	_, err := service.store.Update("r", created.ID, func(f *Feedback) error {
		for len(f.Threads) < MaxThreads {
			f.Threads = append(f.Threads, Thread{Number: f.NextThread})
			f.NextThread++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.AddThread(target, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "x"}); !errors.Is(err, ErrFull) {
		t.Errorf("thread %d = %v, want ErrFull", MaxThreads+1, err)
	}
}

func TestEnsureEvictsTheLeastRecentlyUpdated(t *testing.T) {
	service, _ := testService(t)
	service.store.limit = 3
	var ids []string
	for i := range 3 {
		created, _, err := service.AddThread(Target{Repository: "r", Branch: fmt.Sprint("b", i), Project: "/p"}, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "x"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, created.ID)
	}
	// b0 is touched last, so b1 is the least recently updated.
	if _, _, err := service.AddMessage("r", ids[0], "/p", NewMessage{Thread: 1, Author: AuthorAgent, Body: "y"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.AddThread(Target{Repository: "r", Branch: "b3", Project: "/p"}, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "x"}); err != nil {
		t.Fatal(err)
	}
	summaries, _ := service.List("r")
	var branches []string
	for _, summary := range summaries {
		branches = append(branches, summary.Branch)
	}
	if strings.Join(branches, ",") != "b3,b0,b2" {
		t.Errorf("branches after eviction = %v, want b3,b0,b2", branches)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(service.store.file("r", ids[1])), ids[1]+".lock")); !os.IsNotExist(err) {
		t.Errorf("evicted lock file = %v, want removed", err)
	}
}

func TestConcurrentWritersLoseNothing(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "feedback")
	// Two services over one directory stand in for the CLI and a server.
	services := []*Service{NewService(NewStore(directory)), NewService(NewStore(directory))}
	target := Target{Repository: "r", Branch: "b", Project: "/p"}
	const writers = 16
	var wg sync.WaitGroup
	ids := make(chan string, writers)
	for i := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			created, _, err := services[i%2].AddThread(target, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: fmt.Sprint(i)})
			if err != nil {
				t.Error(err)
				return
			}
			ids <- created.ID
		}()
	}
	wg.Wait()
	close(ids)
	var first string
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Errorf("concurrent creation made %s and %s for one branch", first, id)
		}
	}
	stored, err := services[0].Get("r", first)
	if err != nil || len(stored.Threads) != writers || stored.NextThread != writers+1 {
		t.Fatalf("after %d writers: %d threads, next %d, %v", writers, len(stored.Threads), stored.NextThread, err)
	}
	seen := map[int]bool{}
	for _, thread := range stored.Threads {
		if seen[thread.Number] {
			t.Errorf("thread number %d repeated", thread.Number)
		}
		seen[thread.Number] = true
	}
}

func TestNewIDIsBase32(t *testing.T) {
	service, _ := testService(t)
	service.random = bytes.NewReader([]byte{0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff})
	for _, want := range []string{"fb-aaaaaa", "fb-777777"} {
		if got, err := service.newID(); err != nil || got != want {
			t.Errorf("newID = %q, %v; want %q", got, err, want)
		}
	}
}

func TestStoreSkipsForeignAndBrokenFiles(t *testing.T) {
	service, _ := testService(t)
	created, _, _ := service.AddThread(Target{Repository: "r", Branch: "b", Project: "/p"}, NewThread{Anchor: lineAnchor("a", 1, 1), Author: AuthorUser, Body: "x"})
	repository := filepath.Dir(service.store.file("r", created.ID))
	if err := os.WriteFile(filepath.Join(repository, "fb-bbbbbb.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, "fb-cccccc.json"), []byte(`{"id":"fb-cccccc","repository":"elsewhere","branch":"b"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if summaries, err := service.List("r"); err != nil || len(summaries) != 1 {
		t.Errorf("List = %+v, %v; want only the valid file", summaries, err)
	}
	if _, err := service.Get("r", "fb-cccccc"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get of a foreign file = %v", err)
	}
	if _, err := service.Get("r", "../escape"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get of a bad ID = %v", err)
	}
}
