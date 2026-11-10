package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/flexdinesh/zero/internal/app"
	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
)

func TestFeedbackMarkdownMatchesTheSharedFixture(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "api", "default", "feedback.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored contract.Feedback
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "feedback", "markdown.md"))
	if err != nil {
		t.Fatal(err)
	}
	got := feedbackMarkdown("", stored, stored.Threads, true)
	if got != string(want) {
		t.Errorf("feedbackMarkdown(feedback.json, --all) =\n%s\nwant testdata/feedback/markdown.md =\n%s", got, want)
	}
}

func TestFeedbackMarkdownEdges(t *testing.T) {
	empty := contract.Feedback{Project: "/p", Branch: "", Threads: []contract.FeedbackThread{}}
	if got := feedbackMarkdown("", empty, nil, false); got != "No feedback for detached HEAD in /p yet.\n" {
		t.Errorf("no feedback = %q", got)
	}
	resolved := contract.FeedbackThread{
		Number: 1, Status: contract.FeedbackStatusResolved, Awaiting: contract.FeedbackAwaitingNone,
		Anchor:   contract.FeedbackAnchor{Path: "a.md", Side: contract.FeedbackSideNew, Lines: []int{1, 1}, Text: []string{"```js", "x", "```"}},
		Location: contract.FeedbackLocation{State: contract.FeedbackAnchored, Path: "a.md", Side: contract.FeedbackSideNew, Lines: []int{1, 1}},
		Messages: []contract.FeedbackMessage{{Number: 1, Author: contract.FeedbackAuthorUser, Body: "Fix.\n", CreatedAt: "2026-11-10T09:12:00+02:00"}},
	}
	stored := contract.Feedback{ID: "fb-aaaaaa", Project: "/p", Branch: "main", Threads: []contract.FeedbackThread{resolved}}
	want := "# Feedback fb-aaaaaa\nBranch main · /p · no threads awaiting you\n\nNo threads awaiting you. Use --all to list every thread.\n"
	if got := feedbackMarkdown("", stored, nil, false); got != want {
		t.Errorf("nothing awaiting =\n%q\nwant\n%q", got, want)
	}
	want = "# Feedback fb-aaaaaa\nBranch main · /p · no threads awaiting you\n\n" +
		"Reply: srcz feedback reply fb-aaaaaa <thread> -m \"<what you did>\" [--resolve | --wontfix]\n\n" +
		"## Thread 1 · resolved · a.md:1\n````\n```js\nx\n```\n````\n**user** · 2026-11-10 07:12 UTC\nFix.\n"
	if got := feedbackMarkdown("srcz", stored, stored.Threads, true); got != want {
		t.Errorf("--all with fences in the text =\n%s\nwant\n%s", got, want)
	}
}

func TestParseLines(t *testing.T) {
	for input, want := range map[string][]int{"": nil, "12": {12, 12}, "12-20": {12, 20}} {
		if got, err := parseLines(input); err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("parseLines(%q) = %v, %v; want %v", input, got, err, want)
		}
	}
	for _, input := range []string{"x", "1-", "-3", "1-2-3"} {
		if _, err := parseLines(input); err == nil {
			t.Errorf("parseLines(%q) succeeded", input)
		}
	}
}

// testFeedbackOptions works in a private store from root/sub, with no
// daemon.
func testFeedbackOptions(t *testing.T, root string) feedbackOptions {
	t.Helper()
	return feedbackOptions{
		feedbackDir: filepath.Join(t.TempDir(), "feedback"),
		socket:      filepath.Join(t.TempDir(), "daemon.sock"),
		getwd:       func() (string, error) { return filepath.Join(root, "sub"), nil },
	}
}

func runFeedback(t *testing.T, run feedbackRunner, opts feedbackOptions, stdin string, args ...string) (string, string, error) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	err := run(context.Background(), opts, args, strings.NewReader(stdin), &stdout, &stderr)
	return stdout.String(), stderr.String(), err
}

// userThread starts a thread as the browser does, through the application
// layer over the same store.
func userThread(t *testing.T, opts feedbackOptions, root string, lines []int, body string) contract.FeedbackThread {
	t.Helper()
	roots, err := projects.NewRootSet([]string{root})
	if err != nil {
		t.Fatal(err)
	}
	application, err := app.New(app.Config{Roots: roots, Depth: 5, Types: document.Builtins(), FeedbackDirectory: opts.feedbackDir, WalkthroughDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	thread, err := application.Feedback.CreateThread(context.Background(), contract.FeedbackThreadDraft{Project: root, Path: "doc.md", Lines: lines, Body: body})
	if err != nil {
		t.Fatal(err)
	}
	return thread
}

func TestFeedbackCommands(t *testing.T) {
	root, _ := publishRepo(t)
	opts := testFeedbackOptions(t, root)

	stdout, _, err := runFeedback(t, showFeedback, opts, "")
	if err != nil || stdout != "No feedback for branch master in "+root+" yet.\n" {
		t.Fatalf("show before any thread = %q, %v", stdout, err)
	}

	comment := opts
	comment.path, comment.lines, comment.name, comment.message, comment.hasMessage = "doc.md", "2", "claude", "Is this line needed?", true
	stdout, stderr, err := runFeedback(t, commentFeedback, comment, "")
	if err != nil || stdout != "started thread 1 at doc.md:2\n" {
		t.Fatalf("comment = %q, %v\n%s", stdout, err, stderr)
	}
	stdout, _, err = runFeedback(t, showFeedback, opts, "")
	if err != nil || !strings.HasSuffix(stdout, "· no threads awaiting you\n\nNo threads awaiting you. Use --all to list every thread.\n") {
		t.Errorf("show with only the agent's thread = %q, %v", stdout, err)
	}

	userThread(t, opts, root, []int{1, 1}, "Rename the **heading**.")
	stdout, _, err = runFeedback(t, showFeedback, opts, "")
	header := strings.SplitN(stdout, "\n", 2)[0]
	id := strings.TrimPrefix(header, "# Feedback ")
	want := header + "\nBranch master · " + root + " · 1 thread awaiting you\n\n" +
		"Reply: zero feedback reply " + id + " <thread> -m \"<what you did>\" [--resolve | --wontfix]\n\n" +
		"## Thread 2 · open · doc.md:1\n```markdown\n# Doc\n```\n**user** · "
	if err != nil || !strings.HasPrefix(stdout, want) || !strings.HasSuffix(stdout, " UTC\nRename the **heading**.\n") {
		t.Fatalf("show =\n%s\nwant prefix\n%s", stdout, want)
	}

	asJSON := opts
	asJSON.json = true
	stdout, _, err = runFeedback(t, showFeedback, asJSON, "")
	var shown contract.Feedback
	if err != nil || json.Unmarshal([]byte(stdout), &shown) != nil || shown.ID != id || len(shown.Threads) != 1 || shown.Threads[0].Number != 2 || shown.Threads[0].Messages[0].BodyHTML != "<p>Rename the <strong>heading</strong>.</p>\n" {
		t.Errorf("show --json = %s, %v", stdout, err)
	}

	reply := opts
	reply.message, reply.hasMessage, reply.resolve = "-", true, true
	stdout, stderr, err = runFeedback(t, replyFeedback, reply, "Renamed it.\n", id, "2")
	if err != nil || stdout != "replied to thread 2 (resolved)\n" {
		t.Fatalf("reply = %q, %v\n%s", stdout, err, stderr)
	}
	all := opts
	all.all = true
	stdout, _, err = runFeedback(t, showFeedback, all, "")
	for _, want := range []string{
		"## Thread 1 · open · doc.md:2\n```markdown\nline two\n```\n**agent (claude)** · ",
		"## Thread 2 · resolved · doc.md:1\n",
		" UTC · resolved\nRenamed it.\n",
	} {
		if err != nil || !strings.Contains(stdout, want) {
			t.Errorf("show --all lacks %q:\n%s", want, stdout)
		}
	}

	// A status alone needs no message; a reopen from the agent says so.
	reopen := opts
	reopen.reopen = true
	if stdout, _, err = runFeedback(t, replyFeedback, reopen, "", id, "2"); err != nil || stdout != "replied to thread 2 (reopened)\n" {
		t.Errorf("reply --reopen = %q, %v", stdout, err)
	}

	stdout, _, err = runFeedback(t, listFeedback, opts, "")
	if err != nil || stdout != id+"  master  2 threads, 0 awaiting you\n" {
		t.Errorf("list = %q, %v", stdout, err)
	}
	stdout, _, err = runFeedback(t, listFeedback, asJSON, "")
	var summaries []contract.FeedbackSummary
	if err != nil || json.Unmarshal([]byte(stdout), &summaries) != nil || len(summaries) != 1 || summaries[0].Open != 2 || summaries[0].AwaitingUser != 2 {
		t.Errorf("list --json = %s, %v", stdout, err)
	}

	// Outside the repository, an ID is read where it was written.
	elsewhere := opts
	elsewhere.getwd = func() (string, error) { return t.TempDir(), nil }
	stdout, _, err = runFeedback(t, showFeedback, elsewhere, "", id)
	if err != nil || !strings.Contains(stdout, "Branch master · "+root+" · ") {
		t.Errorf("show %s from elsewhere = %q, %v", id, stdout, err)
	}
}

func TestFeedbackCommandErrors(t *testing.T) {
	root, _ := publishRepo(t)
	opts := testFeedbackOptions(t, root)
	userThread(t, opts, root, nil, "Whole file.")
	asJSON := opts
	asJSON.json = true
	stdout, _, _ := runFeedback(t, showFeedback, asJSON, "")
	var shown contract.Feedback
	if err := json.Unmarshal([]byte(stdout), &shown); err != nil || shown.ID == "" {
		t.Fatalf("show --json = %s", stdout)
	}

	reply := opts
	reply.message, reply.hasMessage = "ok", true
	_, stderr, err := runFeedback(t, replyFeedback, reply, "", shown.ID, "9")
	if !errors.Is(err, errFeedbackRejected) || stderr != "invalid feedback:\n  thread: feedback "+shown.ID+" has no thread 9\n" {
		t.Errorf("reply to a missing thread = %v\n%s", err, stderr)
	}
	if _, _, err := runFeedback(t, replyFeedback, reply, "", "fb-zzzzzz", "1"); err == nil || err.Error() != "no feedback fb-zzzzzz for this repository" {
		t.Errorf("reply to a missing feedback = %v", err)
	}
	if _, _, err := runFeedback(t, replyFeedback, opts, "", shown.ID, "1"); err == nil || !strings.Contains(err.Error(), "-m TEXT") {
		t.Errorf("reply without a message or status = %v", err)
	}
	if _, _, err := runFeedback(t, replyFeedback, reply, "", shown.ID, "first"); err == nil {
		t.Error("reply to thread first succeeded")
	}

	comment := opts
	comment.path, comment.lines, comment.message, comment.hasMessage = "doc.md", "1-9", "x", true
	_, stderr, err = runFeedback(t, commentFeedback, comment, "")
	if !errors.Is(err, errFeedbackRejected) || stderr != "invalid feedback:\n  lines: end 9 is past the file's last line, 2\n" {
		t.Errorf("comment past the end = %v\n%s", err, stderr)
	}
	comment.path, comment.lines = "nope.md", ""
	_, stderr, err = runFeedback(t, commentFeedback, comment, "")
	if !errors.Is(err, errFeedbackRejected) || !strings.Contains(stderr, "  path: is not a file zero shows in the project") {
		t.Errorf("comment on a missing file = %v\n%s", err, stderr)
	}
	comment.path, comment.message = "doc.md", "  "
	_, stderr, err = runFeedback(t, commentFeedback, comment, "")
	if !errors.Is(err, errFeedbackRejected) || stderr != "invalid feedback:\n  body: is required\n" {
		t.Errorf("comment without text = %v\n%s", err, stderr)
	}
}

func TestFeedbackAnnouncesToTheDaemon(t *testing.T) {
	if daemonSupported() != nil {
		t.Skip("no daemon on this platform")
	}
	root, _ := publishRepo(t)
	opts := testFeedbackOptions(t, root)
	fake := serveFakeDaemon(t)
	opts.socket = fake.socket
	comment := opts
	comment.path, comment.message, comment.hasMessage = "doc.md", "File-level.", true
	stdout, stderr, err := runFeedback(t, commentFeedback, comment, "")
	if err != nil || stdout != "started thread 1 at doc.md\n" {
		t.Fatalf("comment = %q, %v\n%s", stdout, err, stderr)
	}
	select {
	case got := <-fake.requests:
		if !strings.HasPrefix(got, `POST /_daemon/feedback {"project":"`+root+`","id":"fb-`) || !strings.HasSuffix(got, `","author":"agent"}`) {
			t.Errorf("daemon request = %s", got)
		}
	default:
		t.Fatal("comment did not announce to the daemon")
	}

	fake.answer(http.StatusNotFound, contract.CodeFeedbackUnavailable)
	if _, stderr, err = runFeedback(t, commentFeedback, comment, ""); err != nil || !strings.Contains(stderr, "serves this project but keeps feedback elsewhere") {
		t.Errorf("a daemon with another store = %v, %q", err, stderr)
	}
}
