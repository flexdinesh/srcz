package daemon

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/flexdinesh/zero/internal/app"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
)

func TestRootsRemoveStopsServingAndSaves(t *testing.T) {
	parent := t.TempDir()
	work, personal := canonicalDir(t, parent, "work"), canonicalDir(t, parent, "personal")
	file := filepath.Join(t.TempDir(), "roots.json")
	set, err := projects.NewRootSet([]string{work, personal})
	if err != nil {
		t.Fatal(err)
	}
	overlapping := filepath.Join(work, "inner")
	roots := NewRoots(set, []string{overlapping}, file)

	left, err := roots.Remove(work)
	if err != nil || !reflect.DeepEqual(left, []string{personal}) {
		t.Fatalf("Remove(work) = %v, %v; want [personal]", left, err)
	}
	if saved, err := LoadRoots(file); err != nil || !reflect.DeepEqual(saved, []string{personal, overlapping}) {
		t.Fatalf("saved = %v, %v; want personal then the skipped root", saved, err)
	}
	// A skipped root stops being kept too.
	if _, err := roots.Remove(overlapping); err != nil {
		t.Fatalf("Remove(skipped) = %v", err)
	}
	if listed := roots.List(); !reflect.DeepEqual(listed, contract.DaemonRoots{Roots: []string{personal}, Skipped: []string{}}) {
		t.Fatalf("List() = %+v", listed)
	}
	var failure *app.Error
	if _, err := roots.Remove(work); !errors.As(err, &failure) || failure.Kind != contract.KindNotFound || failure.Code != contract.CodeNotServed {
		t.Fatalf("Remove(work) twice = %v; want not found %s", err, contract.CodeNotServed)
	}
}

func TestRootsOpenRefusesFoldersZeroCannotRead(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads every directory")
	}
	parent := t.TempDir()
	locked := canonicalDir(t, parent, "locked")
	if err := os.Chmod(locked, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })
	file := filepath.Join(t.TempDir(), "roots.json")
	roots := NewRoots(&projects.RootSet{}, nil, file)

	_, err := roots.Open(locked)
	var failure *app.Error
	if !errors.As(err, &failure) || failure.Kind != contract.KindForbidden || failure.Code != contract.CodeFolderUnreadable || !strings.Contains(failure.Message, locked) {
		t.Fatalf("Open(locked) = %v; want forbidden %s naming the folder", err, contract.CodeFolderUnreadable)
	}
	if served := roots.Set().List(); len(served) != 0 {
		t.Fatalf("roots = %v; want nothing served", served)
	}
	if _, err := os.Stat(file); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("roots file stat = %v; want nothing saved", err)
	}
}
