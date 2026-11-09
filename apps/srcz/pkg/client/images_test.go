package client_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"

	"github.com/flexdinesh/srcz/pkg/client"
	"github.com/flexdinesh/srcz/pkg/contract"
)

// TestImageAtCommitParityAcrossTransports reads images at commits and the
// commits diff sides name, which image diffs read them from (decision 0116).
func TestImageAtCommitParityAcrossTransports(t *testing.T) {
	root := t.TempDir()
	repo, err := gogit.PlainInit(root, false)
	if err != nil {
		t.Fatal(err)
	}
	worktree, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	commit := func(message string) string {
		t.Helper()
		if err := worktree.AddWithOptions(&gogit.AddOptions{All: true}); err != nil {
			t.Fatal(err)
		}
		hash, err := worktree.Commit(message, &gogit.CommitOptions{Author: &object.Signature{Name: "srcz", Email: "srcz@example.com", When: time.Unix(1700000000, 0)}})
		if err != nil {
			t.Fatal(err)
		}
		return hash.String()
	}
	write("README.md", "# One\n")
	write("dot.png", "\x89PNG\r\n\x1a\none")
	first := commit("First")
	write("dot.png", "\x89PNG\r\n\x1a\ntwo")
	write("later.png", "\x89PNG\r\n\x1a\nlater")
	second := commit("Second")
	write("dot.png", "\x89PNG\r\n\x1a\nworking")
	f := serveFixture(t, root)
	ctx := context.Background()

	images := []struct {
		name    string
		request contract.ImageRequest
		content string
		kind    contract.ErrorKind
	}{
		{"at the first commit", contract.ImageRequest{Project: f.root, Path: "dot.png", At: first}, "\x89PNG\r\n\x1a\none", ""},
		{"at the second commit", contract.ImageRequest{Project: f.root, Path: "dot.png", At: second}, "\x89PNG\r\n\x1a\ntwo", ""},
		{"in the working tree", contract.ImageRequest{Project: f.root, Path: "dot.png"}, "\x89PNG\r\n\x1a\nworking", ""},
		{"missing at that commit", contract.ImageRequest{Project: f.root, Path: "later.png", At: first}, "", contract.KindNotFound},
		{"not an image", contract.ImageRequest{Project: f.root, Path: "README.md", At: first}, "", contract.KindNotFound},
		{"escape", contract.ImageRequest{Project: f.root, Path: "../dot.png", At: first}, "", contract.KindNotFound},
		{"invalid hash", contract.ImageRequest{Project: f.root, Path: "dot.png", At: "HEAD"}, "", contract.KindInvalid},
		{"unknown commit", contract.ImageRequest{Project: f.root, Path: "dot.png", At: "0123456789012345678901234567890123456789"}, "", contract.KindNotFound},
	}
	for _, image := range images {
		got := f.same(t, "Image "+image.name, func(c client.Client) outcome { return result(c.Image(ctx, image.request)) })
		read, ok := got.Value.(contract.Image)
		if kindOf(got.Err) != image.kind || !ok || string(read.Content) != image.content {
			t.Errorf("Image %s = %+v, want %q, kind %q", image.name, got, image.content, image.kind)
		}
	}

	sides := []struct {
		name               string
		request            contract.DiffRequest
		original, modified string
	}{
		{"working", contract.DiffRequest{Project: f.root, Path: "dot.png"}, second, ""},
		{"commit", contract.DiffRequest{Project: f.root, Kind: contract.DiffCommit, Commit: second, Path: "dot.png"}, first, second},
		{"range", contract.DiffRequest{Project: f.root, Kind: contract.DiffRange, From: second, To: second, Path: "later.png"}, "", second},
	}
	for _, side := range sides {
		got := f.same(t, "Diff sides "+side.name, func(c client.Client) outcome { return result(c.Diff(ctx, side.request)) })
		response, ok := got.Value.(contract.DiffResponse)
		if !ok || response.Modified == nil || response.Modified.Commit != side.modified {
			t.Fatalf("Diff %s = %+v, want modified at %q", side.name, got, side.modified)
		}
		original := ""
		if response.Original != nil {
			original = response.Original.Commit
		}
		if original != side.original {
			t.Errorf("Diff %s original commit = %q, want %q", side.name, original, side.original)
		}
	}
}
