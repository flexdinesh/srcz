package app

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing/object"

	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/pkg/contract"
)

// blameFixture is a repository on GitHub with two commits and working-tree
// edits.
type blameFixture struct {
	app           *App
	root          string
	initial, edit string
	write         func(name string, content []byte)
}

func newBlameFixture(t *testing.T) blameFixture {
	t.Helper()
	application, root := newTestApp(t)
	repo, err := gogit.PlainInit(root, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateRemote(&config.RemoteConfig{Name: "origin", URLs: []string{"git@github.com:owner/repo.git"}}); err != nil {
		t.Fatal(err)
	}
	worktree, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string, content []byte) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, name)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name), content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	commit := func(message string, when int64) string {
		t.Helper()
		if err := worktree.AddWithOptions(&gogit.AddOptions{All: true}); err != nil {
			t.Fatal(err)
		}
		signature := &object.Signature{Name: "zero", Email: "zero@example.com", When: time.Unix(when, 0).In(time.FixedZone("", -5*60*60))}
		hash, err := worktree.Commit(message, &gogit.CommitOptions{Author: signature, Committer: signature})
		if err != nil {
			t.Fatal(err)
		}
		return hash.String()
	}
	write("a.txt", []byte("one\ntwo\nthree\n"))
	write("same.txt", []byte("kept\n"))
	write("empty.txt", nil)
	write("image.png", []byte("\x89PNG\r\n\x1a\nimage"))
	write("zeros.txt", []byte("a\x00b\n"))
	initial := commit("Initial commit", 1700000000)
	write("a.txt", []byte("one\nTWO\nthree\n"))
	edit := commit("Edit two (#12)\n\n"+strings.Repeat("é", blameBodyLimit), 1700000100)
	write("a.txt", []byte("one\nTWO\nthree!\nfour\n"))
	write("untracked.txt", []byte("x\ny\n"))
	return blameFixture{app: application, root: root, initial: initial, edit: edit, write: write}
}

func (f blameFixture) blame(t *testing.T, path, at string) contract.BlameResponse {
	t.Helper()
	response, err := f.app.SourceControl.Blame(context.Background(), contract.BlameRequest{Project: f.root, Path: path, At: at})
	if err != nil {
		t.Fatalf("Blame(%s, %q) error = %v", path, at, err)
	}
	return response
}

func TestBlameMapsTheWorkingTreeOntoHeadsBlame(t *testing.T) {
	f := newBlameFixture(t)
	got := f.blame(t, "a.txt", "")
	wantRanges := []contract.BlameRange{
		{Start: 1, Count: 1, Kind: contract.BlameCommit, Commit: 0, OriginalLine: 1},
		{Start: 2, Count: 1, Kind: contract.BlameCommit, Commit: 1, OriginalLine: 2},
		{Start: 3, Count: 2, Kind: contract.BlameUncommitted, Commit: -1},
	}
	if !got.Repository || got.Path != "a.txt" || got.Commit != f.edit || got.LineCount != 4 || got.Truncated || !reflect.DeepEqual(got.Ranges, wantRanges) {
		t.Fatalf("blame = %+v\nwant ranges %+v at %s", got, wantRanges, f.edit)
	}
	if len(got.Commits) != 2 {
		t.Fatalf("commits = %+v", got.Commits)
	}
	initial, edit := got.Commits[0], got.Commits[1]
	if initial.Hash != f.initial || initial.Subject != "Initial commit" || initial.Body != "" || initial.PullRequest != nil ||
		initial.Author != (contract.Author{Name: "zero", Email: "zero@example.com"}) || initial.AuthorTime != "2023-11-14T17:13:20-05:00" {
		t.Errorf("initial commit = %+v", initial)
	}
	if edit.Hash != f.edit || edit.Subject != "Edit two (#12)" || len(edit.Body) != blameBodyLimit || !strings.HasPrefix(edit.Body, "éé") {
		t.Errorf("edit commit = %+v (body %d bytes)", edit, len(edit.Body))
	}
	if edit.PullRequest == nil || *edit.PullRequest != (contract.PullRequest{Number: 12, URL: "https://github.com/owner/repo/pull/12"}) {
		t.Errorf("edit pull request = %+v", edit.PullRequest)
	}

	// The commit blame is cached; a later edit maps onto it again.
	f.write("a.txt", []byte("zero\none\nTWO\nthree\n"))
	again := f.blame(t, "a.txt", "")
	wantRanges = []contract.BlameRange{
		{Start: 1, Count: 1, Kind: contract.BlameUncommitted, Commit: -1},
		{Start: 2, Count: 1, Kind: contract.BlameCommit, Commit: 0, OriginalLine: 1},
		{Start: 3, Count: 1, Kind: contract.BlameCommit, Commit: 1, OriginalLine: 2},
		{Start: 4, Count: 1, Kind: contract.BlameCommit, Commit: 0, OriginalLine: 3},
	}
	if !reflect.DeepEqual(again.Ranges, wantRanges) || again.LineCount != 4 {
		t.Fatalf("blame after edit = %+v\nwant %+v", again.Ranges, wantRanges)
	}
}

func TestBlameOfUnchangedAndUntrackedWorkingTreeFiles(t *testing.T) {
	f := newBlameFixture(t)
	same := f.blame(t, "same.txt", "")
	if !reflect.DeepEqual(same.Ranges, []contract.BlameRange{{Start: 1, Count: 1, Kind: contract.BlameCommit, OriginalLine: 1}}) || len(same.Commits) != 1 || same.Commits[0].Hash != f.initial {
		t.Errorf("unchanged blame = %+v", same)
	}
	untracked := f.blame(t, "untracked.txt", "")
	if !reflect.DeepEqual(untracked.Ranges, []contract.BlameRange{{Start: 1, Count: 2, Kind: contract.BlameUncommitted, Commit: -1}}) ||
		len(untracked.Commits) != 0 || untracked.Commit != f.edit || untracked.LineCount != 2 {
		t.Errorf("untracked blame = %+v", untracked)
	}
	empty := f.blame(t, "empty.txt", "")
	if empty.LineCount != 0 || len(empty.Ranges) != 0 || empty.Ranges == nil || empty.Commits == nil {
		t.Errorf("empty blame = %+v", empty)
	}
}

func TestBlameOfAnUnbornHeadIsUncommitted(t *testing.T) {
	application, root := newTestApp(t)
	if _, err := gogit.PlainInit(root, false); err != nil {
		t.Fatal(err)
	}
	response, err := application.SourceControl.Blame(context.Background(), contract.BlameRequest{Project: root, Path: "data.json"})
	if err != nil || !response.Repository || response.Commit != "" ||
		!reflect.DeepEqual(response.Ranges, []contract.BlameRange{{Start: 1, Count: 1, Kind: contract.BlameUncommitted, Commit: -1}}) {
		t.Fatalf("blame = %+v, %v", response, err)
	}
}

func TestBlameAtACommitBlamesThatVersion(t *testing.T) {
	f := newBlameFixture(t)
	got := f.blame(t, "a.txt", f.initial)
	if got.Commit != f.initial || got.LineCount != 3 ||
		!reflect.DeepEqual(got.Ranges, []contract.BlameRange{{Start: 1, Count: 3, Kind: contract.BlameCommit, OriginalLine: 1}}) ||
		len(got.Commits) != 1 || got.Commits[0].Hash != f.initial {
		t.Fatalf("blame at initial = %+v", got)
	}
}

func TestBlameFolderProjectHasNoRepository(t *testing.T) {
	application, root := newTestApp(t)
	response, err := application.SourceControl.Blame(context.Background(), contract.BlameRequest{Project: root, Path: "data.json"})
	if err != nil || response.Repository || response.Ranges == nil || len(response.Ranges) != 0 || response.Commits == nil {
		t.Fatalf("folder blame = %+v, %v", response, err)
	}
	_, err = application.SourceControl.Blame(context.Background(), contract.BlameRequest{Project: root, Path: "data.json", At: strings.Repeat("a", 40)})
	if kindOf(t, err) != contract.KindNotFound {
		t.Fatalf("folder blame at a commit error = %v", err)
	}
}

func TestBlameFailuresAreTyped(t *testing.T) {
	f := newBlameFixture(t)
	f.write("big.txt", bytes.Repeat([]byte("x\n"), document.PreviewLimit/2+1))
	cases := map[string]struct {
		request contract.BlameRequest
		kind    contract.ErrorKind
		code    string
	}{
		"no project":           {contract.BlameRequest{Path: "a.txt"}, contract.KindInvalid, ""},
		"no path":              {contract.BlameRequest{Project: f.root}, contract.KindInvalid, ""},
		"escaping path":        {contract.BlameRequest{Project: f.root, Path: "../a.txt"}, contract.KindInvalid, ""},
		"invalid at":           {contract.BlameRequest{Project: f.root, Path: "a.txt", At: "HEAD"}, contract.KindInvalid, ""},
		"unknown commit":       {contract.BlameRequest{Project: f.root, Path: "a.txt", At: strings.Repeat("1", 40)}, contract.KindNotFound, ""},
		"file not at commit":   {contract.BlameRequest{Project: f.root, Path: "untracked.txt", At: f.edit}, contract.KindNotFound, ""},
		"missing file":         {contract.BlameRequest{Project: f.root, Path: "gone.txt"}, contract.KindNotFound, ""},
		"image":                {contract.BlameRequest{Project: f.root, Path: "image.png"}, contract.KindUnprocessable, contract.CodeBlameUnavailable},
		"image at a commit":    {contract.BlameRequest{Project: f.root, Path: "image.png", At: f.initial}, contract.KindUnprocessable, contract.CodeBlameUnavailable},
		"binary text":          {contract.BlameRequest{Project: f.root, Path: "zeros.txt"}, contract.KindUnprocessable, contract.CodeBlameUnavailable},
		"binary text at":       {contract.BlameRequest{Project: f.root, Path: "zeros.txt", At: f.initial}, contract.KindUnprocessable, contract.CodeBlameUnavailable},
		"over the limit":       {contract.BlameRequest{Project: f.root, Path: "big.txt"}, contract.KindTooLarge, contract.CodeBlameUnavailable},
		"missing project path": {contract.BlameRequest{Project: filepath.Join(f.root, "gone"), Path: "a.txt"}, contract.KindNotFound, ""},
	}
	for name, tc := range cases {
		_, err := f.app.SourceControl.Blame(context.Background(), tc.request)
		var failure *Error
		if !errors.As(err, &failure) || failure.Kind != tc.kind || failure.Code != tc.code {
			t.Errorf("%s error = %#v, want %s %q", name, err, tc.kind, tc.code)
		}
	}
}

func TestPullRequestsComeFromGitHubSubjects(t *testing.T) {
	const repository = "https://github.com/owner/repo"
	cases := []struct {
		subject, via string
		want         int
	}{
		{"Fix the thing (#123)", "", 123},
		{"Fix the thing (#123)  ", "", 123},
		{"Merge pull request #45 from owner/branch", "", 45},
		{"Feature commit", "Merge pull request #67 from owner/feature", 67},
		{"Squashed (#8)", "Merge pull request #67 from owner/feature", 8},
		{"Feature commit", "Merge branch 'main' into feature", 0},
		{"Mentions (#9) in the middle", "", 0},
		{"Merge pull request #0 from owner/branch", "", 0},
		{"Plain", "", 0},
	}
	for _, tc := range cases {
		got := pullRequest(repository, tc.subject, tc.via)
		switch {
		case tc.want == 0 && got != nil:
			t.Errorf("pullRequest(%q, %q) = %+v, want none", tc.subject, tc.via, got)
		case tc.want != 0 && (got == nil || got.Number != tc.want || got.URL != repository+"/pull/"+strconv.Itoa(tc.want)):
			t.Errorf("pullRequest(%q, %q) = %+v, want #%d", tc.subject, tc.via, got, tc.want)
		}
	}
}

func TestGitHubRepositoryReadsOriginURLForms(t *testing.T) {
	for remote, want := range map[string]string{
		"git@github.com:owner/repo.git":         "https://github.com/owner/repo",
		"git@github.com:owner/repo":             "https://github.com/owner/repo",
		"https://github.com/owner/repo.git":     "https://github.com/owner/repo",
		"https://github.com/owner/repo/":        "https://github.com/owner/repo",
		"https://GitHub.com/Owner/my.repo":      "https://github.com/Owner/my.repo",
		"ssh://git@github.com/owner/repo.git":   "https://github.com/owner/repo",
		"SSH://git@GITHUB.COM/owner/repo-x_y/":  "https://github.com/owner/repo-x_y",
		"https://gitlab.com/owner/repo.git":     "",
		"git@github.example.com:owner/repo.git": "",
		"https://github.com/owner":              "",
		"https://github.com/owner/repo/extra":   "",
		"../repo":                               "",
		"":                                      "",
	} {
		if got := githubRepository(remote); got != want {
			t.Errorf("githubRepository(%q) = %q, want %q", remote, got, want)
		}
	}
}

func TestBlameOfANonGitHubOriginHasNoPullRequests(t *testing.T) {
	f := newBlameFixture(t)
	configPath := filepath.Join(f.root, ".git", "config")
	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, bytes.ReplaceAll(content, []byte("git@github.com:"), []byte("git@gitlab.com:")), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, commit := range f.blame(t, "a.txt", "").Commits {
		if commit.PullRequest != nil {
			t.Errorf("%s pull request = %+v", commit.Subject, commit.PullRequest)
		}
	}
}

func TestBlameCacheKeepsTheMostRecentlyUsed(t *testing.T) {
	cache := newBlameCache()
	key := func(n int) blameKey {
		return blameKey{common: "/repo/.git", commit: strconv.Itoa(n + 1), path: "a.txt"}
	}
	for n := range blameCacheSize {
		cache.put(key(n), &blamed{lineCount: n})
	}
	if _, ok := cache.get(key(0)); !ok {
		t.Fatal("first entry missing before eviction")
	}
	cache.put(key(blameCacheSize), &blamed{})
	if _, ok := cache.get(key(1)); ok {
		t.Error("least recently used entry kept")
	}
	for _, n := range []int{0, 2, blameCacheSize} {
		if _, ok := cache.get(key(n)); !ok {
			t.Errorf("entry %d evicted", n)
		}
	}
	var none *blameCache
	none.put(key(0), &blamed{})
	if _, ok := none.get(key(0)); ok {
		t.Error("nil cache kept an entry")
	}
}
