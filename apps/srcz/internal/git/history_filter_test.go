package git

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/filemode"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// by records a commit of tree by an author.
func (f *fixture) by(tree plumbing.Hash, message, name, email string, when int64, parents ...plumbing.Hash) plumbing.Hash {
	f.t.Helper()
	signature := object.Signature{Name: name, Email: email, When: time.Unix(when, 0)}
	commit := &object.Commit{Author: signature, Committer: signature, Message: message, TreeHash: tree, ParentHashes: parents}
	obj := f.repo.Storer.NewEncodedObject()
	if err := commit.Encode(obj); err != nil {
		f.t.Fatal(err)
	}
	hash, err := f.repo.Storer.SetEncodedObject(obj)
	if err != nil {
		f.t.Fatal(err)
	}
	return hash
}

func TestLogFiltersByQuery(t *testing.T) {
	f := newFixture(t)
	tree := f.tree(nil)
	c1 := f.by(tree, "Add parser\n\nHandles YAML anchors.", "Ada Lovelace", "ada@example.com", 100)
	c2 := f.by(tree, "Fix crash", "Grace Hopper", "grace@navy.example", 200, c1)
	c3 := f.by(tree, "Docs", "Ada Lovelace", "ada@example.com", 300, c2)
	f.ref("refs/heads/main", c1)
	f.ref("refs/heads/feature", c3)
	f.symbolic("HEAD", "refs/heads/feature")
	repo := f.open()

	cases := []struct {
		query string
		want  []plumbing.Hash
	}{
		{"parser", []plumbing.Hash{c1}},
		{"yaml ANCHORS", []plumbing.Hash{c1}},
		{"ada", []plumbing.Hash{c3, c1}},
		{"NAVY.example", []plumbing.Hash{c2}},
		{c2.String()[:7], []plumbing.Hash{c2}},
		{strings.ToUpper(c3.String()[:4]), []plumbing.Hash{c3}},
		{"nothing like it", nil},
	}
	for _, test := range cases {
		history := logOf(t, repo, LogOptions{Range: RangeAll, Query: test.query})
		assertHashes(t, "query "+test.query, hashes(history), test.want...)
		if history.More || history.Next != 3 {
			t.Errorf("query %q: More = %v, Next = %d; want false, 3", test.query, history.More, history.Next)
		}
	}
	// Three hexadecimal digits are too short for a hash prefix; c2 can still
	// match by its text.
	short := c2.String()[:3]
	text := strings.ToLower("Fix crash Grace Hopper grace@navy.example")
	if got := hashes(logOf(t, repo, LogOptions{Range: RangeAll, Query: short})); !strings.Contains(text, short) && slices.Contains(got, c2) {
		t.Errorf("query %q matched c2 by hash: %v", short, got)
	}

	// The branch range filters too and still counts every commit ahead.
	branch := logOf(t, repo, LogOptions{Range: RangeBranch, Query: "ada"})
	assertHashes(t, "branch ada", hashes(branch), c3)
	if branch.Ahead != 2 || branch.Next != 2 || branch.More {
		t.Fatalf("branch = Ahead %d, Next %d, More %v", branch.Ahead, branch.Next, branch.More)
	}
}

func TestLogFiltersByPathAgainstFirstParent(t *testing.T) {
	f := newFixture(t)
	exec := file{content: "v2", mode: filemode.Executable}
	root := f.at(f.tree(map[string]file{"dir/a.txt": regular("v1"), "b.txt": regular("b")}), "add a", 100)
	other := f.at(f.tree(map[string]file{"dir/a.txt": regular("v1"), "b.txt": regular("b2")}), "edit b", 200, root)
	modified := f.at(f.tree(map[string]file{"dir/a.txt": regular("v2"), "b.txt": regular("b2")}), "edit a", 300, other)
	chmod := f.at(f.tree(map[string]file{"dir/a.txt": exec, "b.txt": regular("b2")}), "chmod a", 400, modified)
	deleted := f.at(f.tree(map[string]file{"dir/c.txt": regular("c"), "b.txt": regular("b2")}), "delete a", 500, chmod)
	// The folder becomes a file; dir/a.txt stays absent.
	replaced := f.at(f.tree(map[string]file{"dir": regular("now a file"), "b.txt": regular("b2")}), "dir is a file", 600, deleted)
	readded := f.at(f.tree(map[string]file{"dir/a.txt": regular("v3"), "b.txt": regular("b2")}), "re-add a", 700, replaced)

	// side changes a; merging it into main touches a against main, the first
	// parent. Merging main back into side leaves a as side had it.
	side := f.at(f.tree(map[string]file{"dir/a.txt": regular("side"), "b.txt": regular("b2")}), "side edits a", 750, readded)
	mainline := f.at(f.tree(map[string]file{"dir/a.txt": regular("v3"), "b.txt": regular("main")}), "main edits b", 760, readded)
	merge := f.at(f.tree(map[string]file{"dir/a.txt": regular("side"), "b.txt": regular("main")}), "Merge side", 800, mainline, side)
	sideMerge := f.at(f.tree(map[string]file{"dir/a.txt": regular("side"), "b.txt": regular("main")}), "Merge main into side", 810, side, mainline)
	f.ref("refs/heads/main", merge)
	f.ref("refs/heads/side", sideMerge)
	f.symbolic("HEAD", "refs/heads/main")
	repo := f.open()

	history := logOf(t, repo, LogOptions{Range: RangeAll, Path: "dir/a.txt"})
	assertHashes(t, "dir/a.txt", hashes(history), merge, side, readded, deleted, chmod, modified, root)
	// A folder path matches commits that change anything under it.
	assertHashes(t, "dir", hashes(logOf(t, repo, LogOptions{Range: RangeAll, Path: "dir"})),
		merge, side, readded, replaced, deleted, chmod, modified, root)
	assertHashes(t, "b.txt with query", hashes(logOf(t, repo, LogOptions{Range: RangeAll, Path: "b.txt", Query: "edit b"})), other)
	assertHashes(t, "missing", hashes(logOf(t, repo, LogOptions{Range: RangeAll, Path: "nope/a.txt"})))

	sideHistory := logOf(t, repo, LogOptions{Range: RangeAll, Head: Hash(sideMerge), Path: "dir/a.txt"})
	if hashes(sideHistory)[0] != side {
		t.Fatalf("side history = %v; the merge from main leaves a unchanged against side", hashes(sideHistory))
	}

	for _, bad := range []string{"/dir/a.txt", "dir/../a.txt", ".git/HEAD", "dir/"} {
		if _, err := repo.Log(context.Background(), LogOptions{Range: RangeAll, Path: bad}); !errors.Is(err, ErrUnavailable) {
			t.Errorf("Log(path %q) error = %v, want ErrUnavailable", bad, err)
		}
	}
}

func TestLogFilteredPagesStopAtScanLimitAndContinue(t *testing.T) {
	defer func(limit int) { scanLimit = limit }(scanLimit)
	scanLimit = 3
	f := newFixture(t)
	tree := f.tree(nil)
	// Eight commits, newest first c7..c0; c6, c5, and c0 match.
	var chain []plumbing.Hash
	var parents []plumbing.Hash
	for i := range 8 {
		message := "chore"
		if i == 6 || i == 5 || i == 0 {
			message = "match"
		}
		hash := f.at(tree, message, int64(100*(i+1)), parents...)
		chain = append([]plumbing.Hash{hash}, chain...)
		parents = []plumbing.Hash{hash}
	}
	f.ref("refs/heads/main", chain[7])
	f.ref("refs/heads/feature", chain[0])
	f.symbolic("HEAD", "refs/heads/feature")
	repo := f.open()

	for _, options := range []LogOptions{{Range: RangeAll}, {Range: RangeBranch, Base: "main"}} {
		options.Query = "match"
		options.Limit = 50
		options.Head = Hash(chain[0])
		label := string(options.Range)
		// Page 1 tests c7, c6, c5 and stops on the scan cap.
		page := logOf(t, repo, options)
		assertHashes(t, label+" page 1", hashes(page), chain[1], chain[2])
		if !page.More || page.Next != 3 {
			t.Fatalf("%s page 1: More %v, Next %d", label, page.More, page.Next)
		}
		// Page 2 tests c4..c2 and finds nothing.
		options.Skip = page.Next
		page = logOf(t, repo, options)
		assertHashes(t, label+" page 2", hashes(page))
		if !page.More || page.Next != 6 {
			t.Fatalf("%s page 2: More %v, Next %d", label, page.More, page.Next)
		}
		options.Skip = page.Next
		page = logOf(t, repo, options)
		if options.Range == RangeAll {
			assertHashes(t, label+" page 3", hashes(page), chain[7])
			if page.More || page.Next != 8 {
				t.Fatalf("%s page 3: More %v, Next %d", label, page.More, page.Next)
			}
		} else {
			// The branch range holds c7..c1: c0 is main.
			assertHashes(t, label+" page 3", hashes(page))
			if page.More || page.Next != 7 {
				t.Fatalf("%s page 3: More %v, Next %d", label, page.More, page.Next)
			}
		}

		// A full page ends right after its last match.
		options.Skip, options.Limit = 0, 1
		page = logOf(t, repo, options)
		assertHashes(t, label+" limit 1", hashes(page), chain[1])
		if !page.More || page.Next != 2 {
			t.Fatalf("%s limit 1: More %v, Next %d", label, page.More, page.Next)
		}
	}

	// Without a filter the cap does not apply and Next counts the page.
	page := logOf(t, repo, LogOptions{Range: RangeAll, Limit: 5})
	if len(page.Commits) != 5 || page.Next != 5 || !page.More {
		t.Fatalf("unfiltered: %d commits, Next %d, More %v", len(page.Commits), page.Next, page.More)
	}
}

func TestLogFilteredStopsWhenCancelled(t *testing.T) {
	f := newFixture(t)
	commit := f.at(f.tree(map[string]file{"a.txt": regular("a")}), "commit", 100)
	f.ref("refs/heads/master", commit)
	repo := f.open()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, options := range []LogOptions{{Range: RangeAll, Path: "a.txt"}, {Range: RangeBranch, Query: "commit"}} {
		if _, err := repo.Log(ctx, options); !errors.Is(err, context.Canceled) {
			t.Errorf("Log(%+v) error = %v, want context.Canceled", options, err)
		}
	}
}
