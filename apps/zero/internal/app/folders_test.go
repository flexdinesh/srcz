package app

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
)

func TestFolderErrorNamesMacOSPrivacyAndOtherReadFailures(t *testing.T) {
	folder := "/Users/dee/Downloads/archive"
	blocked := &fs.PathError{Op: "open", Path: folder, Err: syscall.EPERM}
	denied := &fs.PathError{Op: "open", Path: folder, Err: syscall.EACCES}
	cases := []struct {
		name, goos string
		err        error
		code       string
		message    string
	}{
		{"macOS privacy", "darwin", blocked, contract.CodePrivacyBlocked,
			"macOS blocked zero from reading /Users/dee/Downloads/archive. Allow /usr/local/bin/zero in System Settings › Privacy & Security › Full Disk Access, then try again."},
		{"macOS permissions", "darwin", denied, contract.CodeFolderUnreadable, "zero can't read /Users/dee/Downloads/archive: permission denied."},
		{"Linux EPERM", "linux", blocked, contract.CodeFolderUnreadable, "zero can't read /Users/dee/Downloads/archive: operation not permitted."},
		{"Linux permissions", "linux", denied, contract.CodeFolderUnreadable, "zero can't read /Users/dee/Downloads/archive: permission denied."},
	}
	for _, test := range cases {
		got := folderError(test.goos, "/usr/local/bin/zero", folder, test.err)
		if got.Kind != contract.KindForbidden || got.Code != test.code || got.Message != test.message {
			t.Errorf("%s: folderError() = %+v; want forbidden %s %q", test.name, got, test.code, test.message)
		}
	}
	if got := folderError("darwin", "", folder, blocked); !strings.Contains(got.Message, "Allow zero in") {
		t.Errorf("folderError() without a binary = %q; want it to name zero", got.Message)
	}
}

// unreadableDir makes a directory its owner cannot list; root reads it
// anyway, so the test skips there.
func unreadableDir(t *testing.T, parent string) string {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("root reads every directory")
	}
	dir := filepath.Join(parent, "locked")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	return dir
}

func TestCheckFolderReportsUnreadableFoldersOnly(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(parent, "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{parent, filepath.Join(parent, "missing"), file} {
		if err := CheckFolder(path); err != nil {
			t.Errorf("CheckFolder(%s) = %v; want nil", path, err)
		}
	}
	locked := unreadableDir(t, parent)
	var failure *Error
	if err := CheckFolder(locked); !errors.As(err, &failure) || failure.Code != contract.CodeFolderUnreadable {
		t.Fatalf("CheckFolder(locked) = %v; want %s", err, contract.CodeFolderUnreadable)
	}
}

// fakeRoots records RootControl calls.
type fakeRoots struct {
	opened, removed []string
}

func (f *fakeRoots) Open(path string) (contract.OpenedRoot, error) {
	f.opened = append(f.opened, path)
	return contract.OpenedRoot{Root: path, Added: true, Replaced: []string{}, Project: path}, nil
}

func (f *fakeRoots) Remove(root string) ([]string, error) {
	f.removed = append(f.removed, root)
	return []string{}, nil
}

func TestRootOperationsNeedRootControl(t *testing.T) {
	application, root := newTestApp(t)
	if listed := application.Projects.List(); listed.ManageRoots {
		t.Fatal("ManageRoots without RootControl")
	}
	for name, err := range map[string]error{
		"OpenRoot":   func() error { _, err := application.Projects.OpenRoot(root); return err }(),
		"RemoveRoot": func() error { _, err := application.Projects.RemoveRoot(root); return err }(),
	} {
		var failure *Error
		if !errors.As(err, &failure) || failure.Kind != contract.KindUnavailable || failure.Code != contract.CodeRootsUnmanaged {
			t.Errorf("%s = %v; want unavailable %s", name, err, contract.CodeRootsUnmanaged)
		}
	}

	control := &fakeRoots{}
	roots, err := projects.NewRootSet([]string{root})
	if err != nil {
		t.Fatal(err)
	}
	managed, err := New(Config{Roots: roots, Depth: 5, Types: document.Builtins(), RootControl: control})
	if err != nil {
		t.Fatal(err)
	}
	if listed := managed.Projects.List(); !listed.ManageRoots || len(listed.Roots) != 1 || listed.Roots[0].Problem != "" {
		t.Fatalf("List() = %+v; want ManageRoots and a readable root", listed)
	}
	if opened, err := managed.Projects.OpenRoot("/elsewhere"); err != nil || opened.Project != "/elsewhere" {
		t.Fatalf("OpenRoot() = %+v, %v", opened, err)
	}
	if removed, err := managed.Projects.RemoveRoot(root); err != nil || removed.Root != root || removed.Roots == nil {
		t.Fatalf("RemoveRoot() = %+v, %v", removed, err)
	}
	if len(control.opened) != 1 || len(control.removed) != 1 {
		t.Fatalf("RootControl calls = %+v", control)
	}
}

func TestManagedDirectoriesBrowseTheHost(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"plain/notes", "plain/repo/.git", "plain/repo/docs"} {
		if err := os.MkdirAll(filepath.Join(parent, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	served := filepath.Join(parent, "plain", "notes")
	roots, err := projects.NewRootSet([]string{served})
	if err != nil {
		t.Fatal(err)
	}
	application, err := New(Config{Roots: roots, Depth: 5, Types: document.Builtins(), RootControl: &fakeRoots{}})
	if err != nil {
		t.Fatal(err)
	}

	listed, err := application.Projects.Directories(filepath.Join(parent, "plain"))
	if err != nil || listed.Path != filepath.Join(parent, "plain") || len(listed.Directories) != 2 || !listed.Directories[1].IsProject {
		t.Fatalf("Directories(plain) = %+v, %v; want notes and the repository", listed, err)
	}
	home, err := os.UserHomeDir()
	if err == nil {
		if listed, err := application.Projects.Directories(""); err == nil && listed.Path != filepath.Clean(home) {
			t.Errorf("Directories(\"\") path = %q; want home %q", listed.Path, home)
		}
	}
	_, err = application.Projects.Directories(filepath.Join(parent, "plain", "repo", "docs"))
	if kindOf(t, err) != contract.KindInvalid || !strings.Contains(err.Error(), "Open "+filepath.Join(parent, "plain", "repo")) {
		t.Errorf("Directories(inside repo) = %v; want it to name the repository", err)
	}
	if _, err := application.Projects.Directories("relative"); kindOf(t, err) != contract.KindInvalid {
		t.Errorf("Directories(relative) = %v; want invalid", err)
	}
	if _, err := application.Projects.Directories(filepath.Join(parent, "missing")); kindOf(t, err) != contract.KindNotFound {
		t.Errorf("Directories(missing) = %v; want not found", err)
	}

	locked := unreadableDir(t, filepath.Join(parent, "plain"))
	listed, err = application.Projects.Directories(filepath.Join(parent, "plain"))
	if err != nil {
		t.Fatal(err)
	}
	for _, directory := range listed.Directories {
		if directory.Path == locked && directory.ProblemCode != contract.CodeFolderUnreadable {
			t.Errorf("locked directory = %+v; want %s", directory, contract.CodeFolderUnreadable)
		}
	}
	var failure *Error
	if _, err := application.Projects.Directories(locked); !errors.As(err, &failure) || failure.Code != contract.CodeFolderUnreadable {
		t.Errorf("Directories(locked) = %v; want %s", err, contract.CodeFolderUnreadable)
	}
}

func TestUnreadableProjectFolderExplainsThePage(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	locked := unreadableDir(t, parent)
	roots := &projects.RootSet{}
	if _, _, err := roots.Add(locked); err != nil {
		t.Fatal(err)
	}
	application, err := New(Config{Roots: roots, Depth: 5, Types: document.Builtins()})
	if err != nil {
		t.Fatal(err)
	}
	listed := application.Projects.List()
	if len(listed.Roots) != 1 || listed.Roots[0].ProblemCode != contract.CodeFolderUnreadable || listed.Roots[0].Problem == "" {
		t.Fatalf("List() roots = %+v; want the unreadable root explained", listed.Roots)
	}
	page, err := application.Documents.Page(contract.PageRequest{Project: locked})
	var failure *Error
	if !errors.As(err, &failure) || failure.Code != contract.CodeFolderUnreadable || page.ErrorCode != contract.CodeFolderUnreadable || page.Error != failure.Message || strings.Contains(page.Error, "read scan root") {
		t.Fatalf("Page() = %+v, %v; want %s in the page", page, err, contract.CodeFolderUnreadable)
	}
}
