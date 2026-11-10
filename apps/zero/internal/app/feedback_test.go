package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/internal/git"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// feedbackRepo is a served repository with a private feedback store: main.go
// and old.txt committed on master.
type feedbackRepo struct {
	t        *testing.T
	root     string
	repo     *gogit.Repository
	worktree *gogit.Worktree
	feedback *Feedback
}

const mainGo = "package main\n\nfunc main() {\n\tgreet()\n}\n"

func newFeedbackRepo(t *testing.T) *feedbackRepo {
	t.Helper()
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	repo, err := gogit.PlainInit(root, false)
	if err != nil {
		t.Fatal(err)
	}
	worktree, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	roots, err := projects.NewRootSet([]string{root})
	if err != nil {
		t.Fatal(err)
	}
	application, err := New(Config{Roots: roots, Depth: 5, Types: document.Builtins(), WalkthroughDirectory: t.TempDir(), FeedbackDirectory: filepath.Join(t.TempDir(), "feedback")})
	if err != nil {
		t.Fatal(err)
	}
	r := &feedbackRepo{t: t, root: root, repo: repo, worktree: worktree, feedback: application.Feedback}
	r.write("main.go", mainGo)
	r.write("old.txt", "one\ntwo\nthree\n")
	r.commit("initial")
	return r
}

func (r *feedbackRepo) write(name, content string) {
	r.t.Helper()
	if err := os.WriteFile(filepath.Join(r.root, name), []byte(content), 0o644); err != nil {
		r.t.Fatal(err)
	}
}

func (r *feedbackRepo) commit(message string) string {
	r.t.Helper()
	if err := r.worktree.AddWithOptions(&gogit.AddOptions{All: true}); err != nil {
		r.t.Fatal(err)
	}
	signature := &object.Signature{Name: "zero", Email: "zero@example.com", When: time.Unix(1700000000, 0)}
	hash, err := r.worktree.Commit(message, &gogit.CommitOptions{Author: signature, Committer: signature, All: true})
	if err != nil {
		r.t.Fatal(err)
	}
	return hash.String()
}

func (r *feedbackRepo) checkout(branch string, create bool) {
	r.t.Helper()
	if err := r.worktree.Checkout(&gogit.CheckoutOptions{Branch: plumbing.NewBranchReferenceName(branch), Create: create, Keep: true}); err != nil {
		r.t.Fatal(err)
	}
}

func (r *feedbackRepo) thread(draft contract.FeedbackThreadDraft) contract.FeedbackThread {
	r.t.Helper()
	draft.Project = r.root
	thread, err := r.feedback.CreateThread(context.Background(), draft)
	if err != nil {
		r.t.Fatalf("CreateThread(%+v) = %v", draft, err)
	}
	return thread
}

func (r *feedbackRepo) get(request contract.FeedbackRequest) contract.Feedback {
	r.t.Helper()
	request.Project = r.root
	stored, err := r.feedback.Get(context.Background(), request)
	if err != nil {
		r.t.Fatalf("Get(%+v) = %v", request, err)
	}
	return stored
}

func problemLines(t *testing.T, err error) []string {
	t.Helper()
	var rejection *FeedbackRejected
	if !errors.As(err, &rejection) || codeOf(err) != contract.CodeInvalidFeedback || AsError(err).Kind != contract.KindInvalid {
		t.Fatalf("error = %v, want an invalidFeedback rejection", err)
	}
	var lines []string
	for _, problem := range rejection.Problems {
		lines = append(lines, problem.Field+": "+problem.Message)
	}
	return lines
}

func TestFeedbackSourceThreadReanchorsInTheWorkingTree(t *testing.T) {
	r := newFeedbackRepo(t)
	notices, cancel := r.feedback.Notices()
	defer cancel()

	empty := r.get(contract.FeedbackRequest{})
	if want := (contract.Feedback{Project: r.root, Branch: "master", Threads: []contract.FeedbackThread{}}); !reflect.DeepEqual(empty, want) {
		t.Fatalf("Get before any thread = %+v, want %+v", empty, want)
	}

	thread := r.thread(contract.FeedbackThreadDraft{Path: "main.go", Lines: []int{4, 4}, Body: "Say *hello*."})
	wantAnchor := contract.FeedbackAnchor{Path: "main.go", Side: contract.FeedbackSideNew, Lines: []int{4, 4}, Text: []string{"\tgreet()"}, Before: []string{"package main", "", "func main() {"}, After: []string{"}"}, Blob: git.BlobHash([]byte(mainGo)), Language: "go"}
	if !reflect.DeepEqual(thread.Anchor, wantAnchor) || thread.Number != 1 || thread.Status != contract.FeedbackStatusOpen || thread.Awaiting != contract.FeedbackAwaitingAgent {
		t.Errorf("thread = %+v\nanchor want %+v", thread, wantAnchor)
	}
	if want := (contract.FeedbackLocation{State: contract.FeedbackAnchored, Path: "main.go", Side: contract.FeedbackSideNew, Lines: []int{4, 4}}); !reflect.DeepEqual(thread.Location, want) {
		t.Errorf("location = %+v, want %+v", thread.Location, want)
	}
	if message := thread.Messages[0]; message.Author != contract.FeedbackAuthorUser || message.BodyHTML != "<p>Say <em>hello</em>.</p>\n" {
		t.Errorf("first message = %+v", message)
	}
	select {
	case notice := <-notices:
		common, _ := projects.CommonDir(r.root)
		if notice.Repository != common || notice.Event.Project != r.root || notice.Event.Branch != "master" || notice.Event.Author != contract.FeedbackAuthorUser || !strings.HasPrefix(notice.Event.ID, "fb-") {
			t.Errorf("notice = %+v", notice)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no notice")
	}

	stored := r.get(contract.FeedbackRequest{})
	if stored.ID == "" || stored.Branch != "master" || len(stored.Threads) != 1 || stored.CreatedAt == "" {
		t.Fatalf("Get = %+v", stored)
	}
	r.write("main.go", "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tgreet()\n}\n")
	if location := r.get(contract.FeedbackRequest{}).Threads[0].Location; location.State != contract.FeedbackMoved || !reflect.DeepEqual(location.Lines, []int{6, 6}) {
		t.Errorf("after an import = %+v, want moved to 6", location)
	}
	r.write("main.go", "package main\n\nfunc main() {}\n")
	if location := r.get(contract.FeedbackRequest{ID: stored.ID}).Threads[0].Location; location.State != contract.FeedbackOutdated || location.Lines != nil {
		t.Errorf("after deleting the line = %+v, want outdated", location)
	}

	// Replies: the agent asks, the user answers, the agent resolves.
	post := func(draft contract.FeedbackMessageDraft) contract.FeedbackThread {
		t.Helper()
		draft.Project, draft.ID, draft.Thread = r.root, stored.ID, 1
		thread, err := r.feedback.PostMessage(context.Background(), draft)
		if err != nil {
			t.Fatalf("PostMessage(%+v) = %v", draft, err)
		}
		return thread
	}
	if replied := post(contract.FeedbackMessageDraft{Body: "Done.", Status: contract.FeedbackStatusResolved, Author: contract.FeedbackAuthorAgent, Name: "claude"}); replied.Status != contract.FeedbackStatusResolved || replied.Awaiting != contract.FeedbackAwaitingUser || replied.Location.State != contract.FeedbackOutdated {
		t.Errorf("agent's resolve = %+v", replied)
	}
	if reopened := post(contract.FeedbackMessageDraft{Body: "Not yet."}); reopened.Status != contract.FeedbackStatusOpen || reopened.Messages[2].Status != contract.FeedbackStatusOpen || reopened.Messages[2].Author != contract.FeedbackAuthorUser {
		t.Errorf("user's reply on a resolved thread = %+v, want reopened", reopened)
	}

	list, err := r.feedback.List(contract.FeedbackListRequest{Project: r.root})
	if err != nil || len(list) != 1 || list[0].ID != stored.ID || list[0].AwaitingAgent != 1 || list[0].Open != 1 {
		t.Errorf("List = %+v, %v", list, err)
	}

	if err := r.feedback.DeleteThread(contract.FeedbackDeleteRequest{Project: r.root, ID: stored.ID, Thread: 1}); err != nil {
		t.Fatal(err)
	}
	if err := r.feedback.Delete(contract.FeedbackDeleteRequest{Project: r.root, ID: stored.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.feedback.Get(context.Background(), contract.FeedbackRequest{Project: r.root, ID: stored.ID}); codeOf(err) != contract.CodeFeedbackUnavailable || AsError(err).Kind != contract.KindNotFound || err.Error() != "no feedback "+stored.ID+" for this repository" {
		t.Errorf("Get of a deleted feedback = %v", err)
	}
}

func TestFeedbackCompareThreadsResolveOnTheirSides(t *testing.T) {
	r := newFeedbackRepo(t)
	r.checkout("topic", true)
	if err := os.Rename(filepath.Join(r.root, "old.txt"), filepath.Join(r.root, "new.txt")); err != nil {
		t.Fatal(err)
	}
	r.write("main.go", "package main\n\nimport \"os\"\n\nfunc main() {\n\tgreet()\n\tos.Exit(0)\n}\n")
	tip := r.commit("topic")
	branch := &contract.FeedbackCompare{Kind: contract.FeedbackCompareBranch, Base: "master"}

	// The old side of a renamed file reads the old path; the review shows the new one.
	old := r.thread(contract.FeedbackThreadDraft{Compare: branch, Path: "new.txt", Side: contract.FeedbackSideOld, Lines: []int{2, 2}, Body: "Why rename?"})
	if old.Anchor.Path != "old.txt" || old.Anchor.Language != "" || !reflect.DeepEqual(old.Anchor.Text, []string{"two"}) || !reflect.DeepEqual(old.Anchor.Compare, branch) {
		t.Errorf("old-side anchor = %+v", old.Anchor)
	}
	if want := (contract.FeedbackLocation{State: contract.FeedbackAnchored, Path: "new.txt", Side: contract.FeedbackSideOld, Lines: []int{2, 2}}); !reflect.DeepEqual(old.Location, want) {
		t.Errorf("old-side location = %+v, want %+v", old.Location, want)
	}
	added := r.thread(contract.FeedbackThreadDraft{Compare: branch, Path: "main.go", Lines: []int{7, 7}, Body: "Exit code?"})
	if added.Anchor.Text[0] != "\tos.Exit(0)" || added.Location.State != contract.FeedbackAnchored {
		t.Errorf("new-side thread = %+v", added)
	}

	stored := r.get(contract.FeedbackRequest{Compare: branch})
	if stored.Branch != "topic" || len(stored.Threads) != 2 || stored.Threads[0].Location.Path != "new.txt" {
		t.Fatalf("Get in the branch compare = %+v", stored)
	}
	// Without a compare, old sides resolve in their own compare.
	if location := r.get(contract.FeedbackRequest{}).Threads[0].Location; location.State != contract.FeedbackAnchored || location.Path != "new.txt" {
		t.Errorf("old side without a compare = %+v", location)
	}
	// The commit compare's sides are the tip and its parent.
	commit := &contract.FeedbackCompare{Kind: contract.FeedbackCompareCommit, Commit: tip}
	if location := r.get(contract.FeedbackRequest{Compare: commit}).Threads[1].Location; location.State != contract.FeedbackAnchored || !reflect.DeepEqual(location.Lines, []int{7, 7}) {
		t.Errorf("new side in the commit compare = %+v", location)
	}
	// The working compare's old side is HEAD, which lacks old.txt.
	working := &contract.FeedbackCompare{Kind: contract.FeedbackCompareWorking}
	if location := r.get(contract.FeedbackRequest{Compare: working}).Threads[0].Location; location.State != contract.FeedbackOutdated || location.Path != "old.txt" {
		t.Errorf("old side in the working compare = %+v", location)
	}

	// From master, a branch compare's head names topic's feedback.
	r.checkout("master", false)
	if fromMaster := r.get(contract.FeedbackRequest{Compare: &contract.FeedbackCompare{Kind: contract.FeedbackCompareBranch, Base: "master", Head: "topic"}}); fromMaster.ID != stored.ID {
		t.Errorf("Get with head topic = %q, want %q", fromMaster.ID, stored.ID)
	}
	if onMaster := r.get(contract.FeedbackRequest{}); onMaster.ID != "" || onMaster.Branch != "master" {
		t.Errorf("Get on master = %+v, want no feedback", onMaster)
	}
}

func TestFeedbackRejections(t *testing.T) {
	r := newFeedbackRepo(t)
	ctx := context.Background()
	branch := &contract.FeedbackCompare{Kind: contract.FeedbackCompareBranch, Base: "master"}
	cases := map[string]struct {
		draft contract.FeedbackThreadDraft
		want  []string
	}{
		"structure": {contract.FeedbackThreadDraft{Path: "/abs", Side: contract.FeedbackSideOld, Lines: []int{1}, Author: "bot"}, []string{
			"path: must be a clean, project-relative path with forward slashes",
			"side: is old, which needs a compare; Source threads use the new side",
			"lines: must be [start, end], got 1 numbers",
			"body: is required",
			`author: must be "user" or "agent"`,
		}},
		"past the end":    {contract.FeedbackThreadDraft{Path: "main.go", Lines: []int{9, 9}, Body: "b"}, []string{"lines: end 9 is past the file's last line, 5"}},
		"not shown":       {contract.FeedbackThreadDraft{Path: ".git/config", Body: "b"}, []string{"path: is not a file zero shows in the project (missing, excluded, or too deep)"}},
		"not on the side": {contract.FeedbackThreadDraft{Compare: &contract.FeedbackCompare{Kind: contract.FeedbackCompareWorking}, Path: "gone.txt", Side: contract.FeedbackSideOld, Body: "b"}, []string{"path: is not a file on the old side of this compare"}},
		"unknown base":    {contract.FeedbackThreadDraft{Compare: &contract.FeedbackCompare{Kind: contract.FeedbackCompareBranch, Base: "nope"}, Path: "main.go", Body: "b"}, []string{"compare.base: is not a branch zero lists"}},
		"unknown commit":  {contract.FeedbackThreadDraft{Compare: &contract.FeedbackCompare{Kind: contract.FeedbackCompareCommit, Commit: strings.Repeat("0", 40)}, Path: "main.go", Body: "b"}, []string{"compare: names an unavailable commit"}},
	}
	for name, test := range cases {
		test.draft.Project = r.root
		_, err := r.feedback.CreateThread(ctx, test.draft)
		if got := problemLines(t, err); !reflect.DeepEqual(got, test.want) {
			t.Errorf("%s: problems = %q, want %q", name, got, test.want)
		}
	}
	r.write("blob.bin", "a\x00b\n")
	_, err := r.feedback.CreateThread(ctx, contract.FeedbackThreadDraft{Project: r.root, Path: "blob.bin", Lines: []int{1, 1}, Body: "b"})
	if got := problemLines(t, err); !reflect.DeepEqual(got, []string{"lines: can't be anchored: the file is binary; comment on the file instead"}) {
		t.Errorf("binary lines = %q", got)
	}
	if thread, err := r.feedback.CreateThread(ctx, contract.FeedbackThreadDraft{Project: r.root, Path: "blob.bin", Body: "b"}); err != nil || thread.Location.State != contract.FeedbackAnchored || thread.Anchor.Blob == "" {
		t.Errorf("binary file-level thread = %+v, %v", thread, err)
	}

	if _, err := r.feedback.CreateThread(ctx, contract.FeedbackThreadDraft{Project: r.root, ID: "fb-zzzzzz", Path: "main.go", Body: "b"}); codeOf(err) != contract.CodeFeedbackUnavailable {
		t.Errorf("thread in an unknown feedback = %v", err)
	}
	if _, err := r.feedback.PostMessage(ctx, contract.FeedbackMessageDraft{Project: r.root, ID: "fb-zzzzzz", Thread: 1, Body: "b"}); codeOf(err) != contract.CodeFeedbackUnavailable {
		t.Errorf("message to an unknown feedback = %v", err)
	}
	if _, err := r.feedback.Get(ctx, contract.FeedbackRequest{Project: r.root, Compare: branch}); err != nil {
		t.Errorf("Get in a compare with nothing ahead = %v", err)
	}
	if _, err := r.feedback.Get(ctx, contract.FeedbackRequest{Project: r.root, Compare: &contract.FeedbackCompare{Kind: "stash"}}); !reflect.DeepEqual(problemLines(t, err), []string{`compare.kind: must be "working", "branch", "commit", or "range"`}) {
		t.Errorf("Get in an unknown compare = %v", err)
	}
	if _, err := r.feedback.Get(ctx, contract.FeedbackRequest{Project: r.root, Compare: &contract.FeedbackCompare{Kind: contract.FeedbackCompareBranch, Base: "nope"}}); codeOf(err) != contract.CodeUnknownBase {
		t.Errorf("Get with an unknown base = %v", err)
	}
	if err := r.feedback.DeleteThread(contract.FeedbackDeleteRequest{Project: r.root, ID: "fb-zzzzzz"}); !reflect.DeepEqual(problemLines(t, err), []string{"thread: is required: a thread number from 1"}) {
		t.Errorf("DeleteThread without a thread = %v", err)
	}
	if _, err := r.feedback.Announce(r.root, "fb-zzzzzz", contract.FeedbackAuthorAgent); codeOf(err) != contract.CodeFeedbackUnavailable {
		t.Errorf("Announce of an unknown feedback = %v", err)
	}
	if _, err := r.feedback.Announce(filepath.Join(r.root, "gone"), "fb-zzzzzz", contract.FeedbackAuthorAgent); codeOf(err) != contract.CodeProjectUnavailable {
		t.Errorf("Announce in an unknown project = %v", err)
	}
}

func TestFeedbackRepositoryKeys(t *testing.T) {
	r := newFeedbackRepo(t)
	if got := FeedbackRepository(r.root); got != filepath.Join(r.root, ".git") {
		t.Errorf("FeedbackRepository(repository) = %s", got)
	}
	folder := t.TempDir()
	if got := FeedbackRepository(folder); got != folder {
		t.Errorf("FeedbackRepository(folder) = %s", got)
	}
	// A detached HEAD keys by "".
	head, err := r.repo.Head()
	if err != nil {
		t.Fatal(err)
	}
	if err := r.worktree.Checkout(&gogit.CheckoutOptions{Hash: head.Hash()}); err != nil {
		t.Fatal(err)
	}
	thread := r.thread(contract.FeedbackThreadDraft{Path: "main.go", Body: "Detached."})
	if stored := r.get(contract.FeedbackRequest{}); stored.Branch != "" || len(stored.Threads) != 1 || stored.Threads[0].Number != thread.Number {
		t.Errorf("detached feedback = %+v", stored)
	}
}
