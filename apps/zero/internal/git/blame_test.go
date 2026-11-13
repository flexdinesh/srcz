package git

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/go-git/go-git/v5/plumbing"
)

// blamed renders a blame as one "subject:line" per row, "^" marking
// boundary lines.
func blamed(t *testing.T, repo *Repository, start plumbing.Hash, name, content string) ([]string, Blame) {
	t.Helper()
	result, err := repo.Blame(context.Background(), Hash(start), name, []byte(content))
	if err != nil {
		t.Fatalf("Blame(%s) error = %v", name, err)
	}
	rows := make([]string, len(result.Lines))
	for i, line := range result.Lines {
		mark := ""
		if line.Boundary {
			mark = "^"
		}
		rows[i] = fmt.Sprintf("%s%s:%d", mark, result.Commits[line.Commit].Subject, line.Line)
	}
	return rows, result
}

func assertRows(t *testing.T, got []string, want ...string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("blame = %q\nwant    %q", got, want)
	}
}

func TestBlameCreditsTheCommitThatLastChangedEachLine(t *testing.T) {
	f := newFixture(t)
	one := f.at(f.tree(map[string]file{"dir/a.txt": regular("a\nb\nc\n")}), "One", 100)
	// A commit that changes another file leaves the blob as it was.
	two := f.at(f.tree(map[string]file{"dir/a.txt": regular("a\nb\nc\n"), "other.txt": regular("x\n")}), "Two", 200, one)
	three := f.at(f.tree(map[string]file{"dir/a.txt": regular("a\nB\nc\n"), "other.txt": regular("x\n")}), "Three", 300, two)
	four := f.at(f.tree(map[string]file{"dir/a.txt": regular("new\na\nB\nc\nd\n"), "other.txt": regular("y\n")}), "Four", 400, three)

	rows, result := blamed(t, f.open(), four, "dir/a.txt", "new\na\nB\nc\nd\n")
	assertRows(t, rows, "Four:1", "One:1", "Three:2", "One:3", "Four:5")
	if result.Truncated {
		t.Fatal("Truncated = true")
	}
	var subjects []string
	for _, commit := range result.Commits {
		subjects = append(subjects, commit.Subject)
		if commit.Via != "" || commit.ViaSubject != "" {
			t.Fatalf("commit %s via %q", commit.Subject, commit.Via)
		}
	}
	if strings.Join(subjects, ",") != "Four,Three,One" {
		t.Fatalf("commits = %v, want walk order Four, Three, One", subjects)
	}
	if root := result.Commits[2]; root.Hash != one.String() || root.Author.Name != "zero" || root.AuthorTime.Unix() != 100 {
		t.Fatalf("root commit = %+v", root)
	}
}

func TestBlameOfRootCommitCreditsEveryLineToIt(t *testing.T) {
	f := newFixture(t)
	root := f.at(f.tree(map[string]file{"a.txt": regular("a\nb")}), "Root", 100)
	rows, _ := blamed(t, f.open(), root, "a.txt", "a\nb")
	assertRows(t, rows, "Root:1", "Root:2")
}

func TestBlameGivesMergedLinesToTheFirstParentThatHasThem(t *testing.T) {
	f := newFixture(t)
	base := f.at(f.tree(map[string]file{"a.txt": regular("1\n2\n")}), "Base", 100)
	main := f.at(f.tree(map[string]file{"a.txt": regular("1\n2\nz\n")}), "Main", 200, base)
	side := f.at(f.tree(map[string]file{"a.txt": regular("1\n2\nz\n")}), "Side", 300, base)
	merged := "1\n2\nz\nmerge\n"
	first := f.at(f.tree(map[string]file{"a.txt": regular(merged)}), "Merge main first", 400, main, side)
	swapped := f.at(f.tree(map[string]file{"a.txt": regular(merged)}), "Merge side first", 400, side, main)

	repo := f.open()
	rows, result := blamed(t, repo, first, "a.txt", merged)
	assertRows(t, rows, "Base:1", "Base:2", "Main:3", "Merge main first:4")
	if len(result.Commits) != 3 {
		t.Fatalf("commits = %+v, want Base once", result.Commits)
	}
	rows, _ = blamed(t, repo, swapped, "a.txt", merged)
	assertRows(t, rows, "Base:1", "Base:2", "Side:3", "Merge side first:4")
}

func TestBlameCreditsSideBranchCommitsWithTheirMerge(t *testing.T) {
	f := newFixture(t)
	base := f.at(f.tree(map[string]file{"a.txt": regular("a\n")}), "Base", 100)
	main := f.at(f.tree(map[string]file{"a.txt": regular("a\nmain\n")}), "Main (#7)", 200, base)
	early := f.at(f.tree(map[string]file{"a.txt": regular("early\na\n")}), "Early", 150, base)
	feature := f.at(f.tree(map[string]file{"a.txt": regular("early\nfeature\na\n")}), "Feature", 250, early)
	merged := "early\nfeature\na\nmain\n"
	merge := f.at(f.tree(map[string]file{"a.txt": regular(merged)}), "Merge pull request #42 from me/feature", 300, main, feature)

	rows, result := blamed(t, f.open(), merge, "a.txt", merged)
	assertRows(t, rows, "Early:1", "Feature:2", "Base:1", "Main (#7):2")
	for _, commit := range result.Commits {
		wantVia := ""
		if commit.Subject == "Early" || commit.Subject == "Feature" {
			wantVia = merge.String()
		}
		if commit.Via != wantVia {
			t.Errorf("%s via %q, want %q", commit.Subject, commit.Via, wantVia)
		}
		if wantVia != "" && commit.ViaSubject != "Merge pull request #42 from me/feature" {
			t.Errorf("%s via subject %q", commit.Subject, commit.ViaSubject)
		}
	}
}

func TestBlameDoesNotFollowRenames(t *testing.T) {
	f := newFixture(t)
	old := f.at(f.tree(map[string]file{"old.txt": regular("a\nb\n")}), "Old", 100)
	renamed := f.at(f.tree(map[string]file{"new.txt": regular("a\nb\n")}), "Rename", 200, old)
	rows, _ := blamed(t, f.open(), renamed, "new.txt", "a\nb\n")
	assertRows(t, rows, "Rename:1", "Rename:2")
}

func TestBlameMarksLinesPastAShallowCommitAsBoundary(t *testing.T) {
	f := newFixture(t)
	one := f.at(f.tree(map[string]file{"a.txt": regular("a\n")}), "One", 100)
	two := f.at(f.tree(map[string]file{"a.txt": regular("a\nb\n")}), "Two", 200, one)
	three := f.at(f.tree(map[string]file{"a.txt": regular("a\nb\nc\n")}), "Three", 300, two)
	if err := f.repo.Storer.SetShallow([]plumbing.Hash{two}); err != nil {
		t.Fatal(err)
	}
	rows, result := blamed(t, f.open(), three, "a.txt", "a\nb\nc\n")
	assertRows(t, rows, "^Two:1", "^Two:2", "Three:3")
	if result.Truncated {
		t.Fatal("a shallow history is not a truncated walk")
	}
}

func TestBlameStopsAtItsCommitBound(t *testing.T) {
	defer func(limit int) { blameLimit = limit }(blameLimit)
	blameLimit = 2
	f := newFixture(t)
	one := f.at(f.tree(map[string]file{"a.txt": regular("a\n")}), "One", 100)
	two := f.at(f.tree(map[string]file{"a.txt": regular("a\nb\n")}), "Two", 200, one)
	three := f.at(f.tree(map[string]file{"a.txt": regular("a\nb\nc\n")}), "Three", 300, two)
	four := f.at(f.tree(map[string]file{"a.txt": regular("a\nb\nc\nd\n")}), "Four", 400, three)

	rows, result := blamed(t, f.open(), four, "a.txt", "a\nb\nc\nd\n")
	assertRows(t, rows, "^Two:1", "^Two:2", "Three:3", "Four:4")
	if !result.Truncated {
		t.Fatal("Truncated = false")
	}
}

func TestBlameStopsWhenCancelled(t *testing.T) {
	f := newFixture(t)
	one := f.at(f.tree(map[string]file{"a.txt": regular("a\n")}), "One", 100)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.open().Blame(ctx, Hash(one), "a.txt", []byte("a\n")); !errors.Is(err, context.Canceled) {
		t.Fatalf("Blame() error = %v, want context.Canceled", err)
	}
}

func TestBlameOfAMissingFileIsUnavailable(t *testing.T) {
	f := newFixture(t)
	one := f.at(f.tree(map[string]file{"a.txt": regular("a\n")}), "One", 100)
	repo := f.open()
	for _, name := range []string{"b.txt", "a.txt/b", "../a.txt", ""} {
		if _, err := repo.Blame(context.Background(), Hash(one), name, []byte("a\n")); !errors.Is(err, ErrUnavailable) {
			t.Errorf("Blame(%q) error = %v, want ErrUnavailable", name, err)
		}
	}
	if _, err := repo.Blame(context.Background(), Hash(plumbing.NewHash(strings.Repeat("1", 40))), "a.txt", []byte("a\n")); !errors.Is(err, ErrUnavailable) {
		t.Errorf("Blame(unknown commit) error = %v, want ErrUnavailable", err)
	}
}

func TestBlameOfEmptyContentHasNoLines(t *testing.T) {
	f := newFixture(t)
	one := f.at(f.tree(map[string]file{"a.txt": regular("")}), "One", 100)
	rows, result := blamed(t, f.open(), one, "a.txt", "")
	if len(rows) != 0 || len(result.Commits) != 0 {
		t.Fatalf("blame = %v, %+v", rows, result)
	}
}

func TestBlameSplitsRowsAsEditorsDo(t *testing.T) {
	f := newFixture(t)
	one := f.at(f.tree(map[string]file{"a.txt": regular("a\rb\r\nc\n")}), "One", 100)
	two := f.at(f.tree(map[string]file{"a.txt": regular("a\rB\r\nc\n")}), "Two", 200, one)
	rows, _ := blamed(t, f.open(), two, "a.txt", "a\rB\r\nc\n")
	assertRows(t, rows, "One:1", "Two:2", "One:3")
}
