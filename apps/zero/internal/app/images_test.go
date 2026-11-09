package app

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"

	"github.com/flexdinesh/zero/pkg/contract"
)

func TestReadImageIsRootConfinedImagesOnlyAndBounded(t *testing.T) {
	application, root := newTestApp(t)
	png := []byte("\x89PNG\r\n\x1a\n")
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string][]byte{"assets/a.png": png, "big.png": bytes.Repeat([]byte{1}, contract.MaxImageBytes+1)} {
		if err := os.WriteFile(filepath.Join(root, name), content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	image, err := application.Documents.ReadImage(contract.ImageRequest{Project: root, Path: "assets/a.png"})
	if err != nil || image.MediaType != "image/png" || !bytes.Equal(image.Content, png) {
		t.Fatalf("image = %q %q, %v", image.MediaType, image.Content, err)
	}
	cases := map[string]struct {
		project, path string
		kind          contract.ErrorKind
		message       string
	}{
		"text":    {root, "data.json", contract.KindNotFound, contract.ImageUnavailableMessage},
		"missing": {root, "gone.png", contract.KindNotFound, contract.ImageUnavailableMessage},
		"escape":  {root, "../a.png", contract.KindNotFound, contract.ImageUnavailableMessage},
		"project": {filepath.Join(root, "gone"), "assets/a.png", contract.KindNotFound, contract.ImageUnavailableMessage},
		"large":   {root, "big.png", contract.KindTooLarge, contract.ImageTooLargeMessage},
	}
	for name, test := range cases {
		_, err := application.Documents.ReadImage(contract.ImageRequest{Project: test.project, Path: test.path})
		var failure *Error
		if !errors.As(err, &failure) || failure.Kind != test.kind || failure.Message != test.message {
			t.Errorf("%s error = %v, want %s %q", name, err, test.kind, test.message)
		}
	}
}

// TestReadImageAtCommitReadsThatCommitsTree reads images from a commit's
// tree only: images the commit has, within contract.MaxImageBytes
// (decision 0116).
func TestReadImageAtCommitReadsThatCommitsTree(t *testing.T) {
	application, root := newTestApp(t)
	repo, err := gogit.PlainInit(root, false)
	if err != nil {
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
	commit := func() string {
		t.Helper()
		if err := worktree.AddWithOptions(&gogit.AddOptions{All: true}); err != nil {
			t.Fatal(err)
		}
		hash, err := worktree.Commit("commit", &gogit.CommitOptions{Author: &object.Signature{Name: "zero", Email: "zero@example.com", When: time.Unix(1700000000, 0)}})
		if err != nil {
			t.Fatal(err)
		}
		return hash.String()
	}
	before := []byte("\x89PNG\r\n\x1a\nbefore")
	write("assets/a.png", before)
	write("big.png", bytes.Repeat([]byte{1}, contract.MaxImageBytes+1))
	first := commit()
	write("assets/a.png", []byte("\x89PNG\r\n\x1a\nafter"))
	write("assets/later.png", []byte("\x89PNG\r\n\x1a\nlater"))
	second := commit()
	write("assets/a.png", []byte("\x89PNG\r\n\x1a\nworking"))

	image, err := application.Documents.ReadImage(contract.ImageRequest{Project: root, Path: "assets/a.png", At: first})
	if err != nil || image.MediaType != "image/png" || !bytes.Equal(image.Content, before) {
		t.Fatalf("image at first = %q %q, %v", image.MediaType, image.Content, err)
	}
	if image, err := application.Documents.ReadImage(contract.ImageRequest{Project: root, Path: "assets/later.png", At: second}); err != nil || string(image.Content) != "\x89PNG\r\n\x1a\nlater" {
		t.Fatalf("image at second = %q, %v", image.Content, err)
	}
	if image, err := application.Documents.ReadImage(contract.ImageRequest{Project: root, Path: "assets/a.png"}); err != nil || string(image.Content) != "\x89PNG\r\n\x1a\nworking" {
		t.Fatalf("working image = %q, %v", image.Content, err)
	}
	unavailable := contract.ImageUnavailableMessage
	cases := map[string]struct {
		request contract.ImageRequest
		kind    contract.ErrorKind
		message string
	}{
		"missing at that commit": {contract.ImageRequest{Project: root, Path: "assets/later.png", At: first}, contract.KindNotFound, unavailable},
		"not an image":           {contract.ImageRequest{Project: root, Path: "data.json", At: first}, contract.KindNotFound, unavailable},
		"over the limit":         {contract.ImageRequest{Project: root, Path: "big.png", At: first}, contract.KindTooLarge, contract.ImageTooLargeMessage},
		"escape":                 {contract.ImageRequest{Project: root, Path: "../assets/a.png", At: first}, contract.KindNotFound, unavailable},
		"dot segments":           {contract.ImageRequest{Project: root, Path: "assets/../assets/a.png", At: first}, contract.KindNotFound, unavailable},
		"git directory":          {contract.ImageRequest{Project: root, Path: ".git/a.png", At: first}, contract.KindNotFound, unavailable},
		"abbreviated hash":       {contract.ImageRequest{Project: root, Path: "assets/a.png", At: first[:7]}, contract.KindInvalid, InvalidCommitMessage},
		"symbolic ref":           {contract.ImageRequest{Project: root, Path: "assets/a.png", At: "HEAD"}, contract.KindInvalid, InvalidCommitMessage},
		"unknown commit":         {contract.ImageRequest{Project: root, Path: "assets/a.png", At: "0123456789012345678901234567890123456789"}, contract.KindNotFound, unavailable},
		"unknown project":        {contract.ImageRequest{Project: filepath.Join(root, "gone"), Path: "assets/a.png", At: first}, contract.KindNotFound, unavailable},
	}
	for name, test := range cases {
		_, err := application.Documents.ReadImage(test.request)
		var failure *Error
		if !errors.As(err, &failure) || failure.Kind != test.kind || failure.Message != test.message {
			t.Errorf("%s error = %v, want %s %q", name, err, test.kind, test.message)
		}
	}
}

func TestReadImageAtCommitOutsideRepositoryIsUnavailable(t *testing.T) {
	application, root := newTestApp(t)
	if err := os.WriteFile(filepath.Join(root, "a.png"), []byte("\x89PNG\r\n\x1a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := application.Documents.ReadImage(contract.ImageRequest{Project: root, Path: "a.png", At: "0123456789012345678901234567890123456789"})
	var failure *Error
	if !errors.As(err, &failure) || failure.Kind != contract.KindNotFound || failure.Message != contract.ImageUnavailableMessage {
		t.Errorf("error = %v, want not found", err)
	}
}
