//go:build linux || darwin

package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
)

func repositoryRoot(t *testing.T) string {
	t.Helper()
	root, err := git(".", "rev-parse", "--show-toplevel")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

// Every image input comes from the group's fingerprinted files: ctx-src is
// exactly the manifest, other contexts are subsets, and the toolchain context
// is derived from the manifest's mise.lock alone.
func TestBuildContextsMatchFingerprintInputs(t *testing.T) {
	s, err := readWorkingSnapshot(repositoryRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	required := map[string][]string{
		"ctx-src":        {"tools/validate/Dockerfile", "tools/validate/compose.yaml", "mise.toml", "mise.lock", ".gitignore"},
		"ctx-node":       {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "apps/web/package.json", "apps/site/package.json", "packages/contracts/package.json"},
		"ctx-gomod":      {"go.work", "apps/zero/go.mod", "apps/zero/go.sum", "tools/go.mod"},
		"ctx-desktopmod": {"apps/desktop/go.mod", "apps/desktop/go.sum", "apps/zero/go.mod", "apps/zero/go.sum"},
		"ctx-web":        {"apps/web/package.json", "apps/web/vite.config.ts", "packages/contracts/package.json", "mise.toml", "pnpm-lock.yaml"},
		"ctx-bin":        {"apps/zero/main.go", "apps/zero/go.mod", "go.work", "tools/go.mod", "mise.toml"},
		"ctx-toolchain":  {"mise.toml", "mise.lock"},
	}
	available := map[string]bool{}
	for _, e := range s.Entries {
		available[e.Path] = true
	}
	for group := range groupTargets {
		m, _, err := manifest(s, group, "", nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		contexts, err := buildContexts(m)
		if err != nil {
			t.Fatal(err)
		}
		inputs := map[string]entry{}
		for _, e := range m.Files {
			inputs[e.Path] = e
		}
		if names := keys(contexts); !slices.Equal(names, sorted(targetContexts[groupTargets[group]])) {
			t.Fatalf("%s contexts %v, want %v", group, names, targetContexts[groupTargets[group]])
		}
		if !slices.EqualFunc(contexts["ctx-src"], m.Files, func(a, b entry) bool { return a.Path == b.Path && a.Blob == b.Blob && a.Mode == b.Mode }) {
			t.Fatalf("%s ctx-src differs from its fingerprinted inputs", group)
		}
		for name, files := range contexts {
			present := map[string]bool{}
			for _, e := range files {
				present[e.Path] = true
				if name == "ctx-toolchain" {
					continue
				}
				if input, ok := inputs[e.Path]; !ok || input.Blob != e.Blob || input.Mode != e.Mode {
					t.Fatalf("%s %s carries %s outside the group's inputs", group, name, e.Path)
				}
			}
			// Inside a validation container the repository is one group's
			// inputs; require only files this snapshot has.
			for _, path := range required[name] {
				if available[path] && !present[path] {
					t.Fatalf("%s %s lacks %s", group, name, path)
				}
			}
		}
		for _, e := range contexts["ctx-web"] {
			if strings.HasSuffix(e.Path, ".test.ts") || strings.HasPrefix(e.Path, "apps/web/test-fixtures/") {
				t.Fatalf("%s web build reads test input %s", group, e.Path)
			}
		}
		for _, e := range contexts["ctx-bin"] {
			if strings.HasSuffix(e.Path, "_test.go") {
				t.Fatalf("%s binary reads test input %s", group, e.Path)
			}
		}
	}
}

// Shared stages share layers only if their contexts are identical across the
// groups that use them.
func TestSharedStageContextsAreIdenticalAcrossGroups(t *testing.T) {
	s, err := readWorkingSnapshot(repositoryRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, group := range []string{"go", "frontend", "tooling", "docs", "browser", "desktop"} {
		m, _, err := manifest(s, group, "", nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		contexts, err := buildContexts(m)
		if err != nil {
			t.Fatal(err)
		}
		for name, files := range contexts {
			if name == "ctx-src" {
				continue
			}
			identity := contentIdentity([]byte(strings.Join(entryLines(files), "\n")))
			if previous, ok := seen[name]; ok && previous != identity {
				t.Fatalf("%s differs for %s; shared stages would rebuild per group", name, group)
			}
			seen[name] = identity
		}
	}
}

func TestToolchainContextIgnoresTaskEdits(t *testing.T) {
	lock := "[[tools.go]]\nversion = \"1.26.8\"\nbackend = \"core:go\"\n\n[[tools.dagger]]\nversion = \"0.21.10\"\n\n[[tools.node]]\nversion = \"24.1.0\"\nbackend = \"core:node\"\n\n[[tools.pnpm]]\nversion = \"10.0.0\"\nspecifiers = [\"10\"]\nbackend = \"aqua:pnpm/pnpm\"\n"
	first, err := toolchainContext([]entry{{Path: "mise.lock", Content: []byte(lock)}, {Path: "mise.toml", Content: []byte("[tasks.a]\nrun = \"a\"\n")}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := toolchainContext([]entry{{Path: "mise.lock", Content: []byte(lock)}, {Path: "mise.toml", Content: []byte("[tasks.b]\nrun = \"b\"\n")}})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(entryLines(first), entryLines(second)) {
		t.Fatal("task edits changed the toolchain context")
	}
	for _, e := range first {
		if strings.Contains(string(e.Content), "dagger") {
			t.Fatalf("toolchain context keeps unrelated tools: %s", e.Content)
		}
	}
	if _, err := toolchainContext([]entry{{Path: "mise.toml"}}); err == nil {
		t.Fatal("toolchain context without mise.lock accepted")
	}
}

func TestContextTreesHardlinkOneObjectPerFile(t *testing.T) {
	root := t.TempDir()
	store := objectStore{filepath.Join(root, "objects")}
	files := []entry{
		{Path: "a.txt", Mode: "100644", Content: []byte("same")},
		{Path: "dir/run.sh", Mode: "100755", Content: []byte("#!/bin/sh\n")},
		{Path: "dir/link", Mode: "120000", Content: []byte("run.sh")},
	}
	for _, name := range []string{"one", "two"} {
		if err := store.materialize(filepath.Join(root, name), files); err != nil {
			t.Fatal(err)
		}
	}
	first, err := os.Stat(filepath.Join(root, "one", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := os.Stat(filepath.Join(root, "two", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	stat, ok := first.Sys().(*syscall.Stat_t)
	if !ok || !os.SameFile(first, second) || stat.Nlink != 3 {
		t.Fatal("context files are not hardlinks to one object")
	}
	script, err := os.Stat(filepath.Join(root, "two", "dir", "run.sh"))
	if err != nil || script.Mode().Perm() != 0755 {
		t.Fatalf("executable mode lost: %v %v", script, err)
	}
	if target, err := os.Readlink(filepath.Join(root, "one", "dir", "link")); err != nil || target != "run.sh" {
		t.Fatalf("symlink not preserved: %q %v", target, err)
	}
	if err := store.materialize(filepath.Join(root, "bad"), []entry{{Path: "x", Mode: "120000", Content: []byte("../../etc/passwd")}}); err == nil {
		t.Fatal("escaping symlink materialized")
	}
}

func keys[T any](m map[string]T) []string {
	out := make([]string, 0, len(m))
	for name := range m {
		out = append(out, name)
	}
	slices.Sort(out)
	return out
}

func sorted(values []string) []string {
	out := append([]string{}, values...)
	slices.Sort(out)
	return out
}

func entryLines(files []entry) []string {
	var lines []string
	for _, e := range files {
		lines = append(lines, e.Path+"\x00"+e.Mode+"\x00"+contentIdentity(e.Content))
	}
	return lines
}
