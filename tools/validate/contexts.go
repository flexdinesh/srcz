//go:build linux || darwin

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Image targets per container group. Extended groups share their correctness
// group's image; their certificates stay separate.
var groupTargets = map[string]string{
	"go": "go", "frontend": "frontend", "tooling": "tooling", "docs": "docs",
	"browser": "browser", "browser-extended": "browser", "webkit": "browser",
	"desktop": "desktop", "desktop-extended": "desktop",
}

// Named build contexts each target's stages read (see Dockerfile).
var targetContexts = map[string][]string{
	"go":       {"ctx-toolchain", "ctx-node", "ctx-gomod", "ctx-web", "ctx-src"},
	"frontend": {"ctx-toolchain", "ctx-node", "ctx-src"},
	"tooling":  {"ctx-toolchain", "ctx-node", "ctx-src"},
	"docs":     {"ctx-toolchain", "ctx-node", "ctx-src"},
	"browser":  {"ctx-toolchain", "ctx-node", "ctx-gomod", "ctx-web", "ctx-bin", "ctx-src"},
	"desktop":  {"ctx-toolchain", "ctx-node", "ctx-gomod", "ctx-desktopmod", "ctx-web", "ctx-bin", "ctx-src"},
}

// Stages rebuilt under --force: the application builds and group images.
// Base, toolchain, and dependency stages stay cached.
func forceRebuildStages(target string) []string {
	return []string{"source", "web", "binary", target}
}

func isNodeManifest(name string) bool {
	switch name {
	case "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs", "apps/web/package.json", "apps/site/package.json", "packages/contracts/package.json":
		return true
	}
	return strings.HasPrefix(name, "patches/")
}

// contextPredicates select each named context from a group's fingerprinted
// files. ctx-toolchain is derived from mise.lock instead (toolchainContext).
var contextPredicates = map[string]func(string) bool{
	"ctx-src":  func(string) bool { return true },
	"ctx-node": isNodeManifest,
	"ctx-gomod": func(name string) bool {
		return name == "go.work" || name == "apps/srcz/go.mod" || name == "apps/srcz/go.sum" || name == "tools/go.mod"
	},
	"ctx-desktopmod": func(name string) bool {
		return name == "apps/desktop/go.mod" || name == "apps/desktop/go.sum" || name == "apps/srcz/go.mod" || name == "apps/srcz/go.sum"
	},
	"ctx-web": func(name string) bool {
		if strings.HasPrefix(name, "apps/web/") {
			return !strings.HasSuffix(name, ".test.ts") && !strings.HasSuffix(name, ".test.tsx") && !strings.HasPrefix(name, "apps/web/test-fixtures/")
		}
		switch name {
		case "mise.toml", "mise.lock", ".node-version", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "apps/site/package.json":
			return true
		}
		return strings.HasPrefix(name, "packages/") || strings.HasPrefix(name, "patches/")
	},
	"ctx-bin": func(name string) bool {
		if strings.HasSuffix(name, "_test.go") {
			return false
		}
		switch name {
		case "mise.toml", "mise.lock", ".node-version", "go.work", "tools/go.mod", "apps/srcz/go.mod", "apps/srcz/go.sum":
			return true
		}
		if strings.HasPrefix(name, "apps/srcz/") && !strings.Contains(strings.TrimPrefix(name, "apps/srcz/"), "/") {
			return strings.HasSuffix(name, ".go")
		}
		for _, prefix := range []string{"apps/srcz/cmd/", "apps/srcz/internal/", "apps/srcz/pkg/"} {
			if strings.HasPrefix(name, prefix) {
				return true
			}
		}
		return false
	},
}

// buildContexts derives every named context for a group's target from the
// same files that make up its fingerprint, so image inputs cannot diverge from
// certificate inputs.
func buildContexts(m inputManifest) (map[string][]entry, error) {
	target, ok := groupTargets[m.Group]
	if !ok {
		return nil, fmt.Errorf("no image target for group %q", m.Group)
	}
	contexts := map[string][]entry{}
	for _, name := range targetContexts[target] {
		if name == "ctx-toolchain" {
			files, err := toolchainContext(m.Files)
			if err != nil {
				return nil, err
			}
			contexts[name] = files
			continue
		}
		keep := contextPredicates[name]
		files := []entry{}
		for _, e := range m.Files {
			if keep(e.Path) {
				files = append(files, e)
			}
		}
		contexts[name] = files
	}
	return contexts, nil
}

// toolchainContext depends on locked tools, not unrelated task definitions:
// it keeps mise's backend/checksum records for go, node, and pnpm only.
func toolchainContext(files []entry) ([]entry, error) {
	var lock string
	found := false
	for _, e := range files {
		if e.Path == "mise.lock" {
			lock, found = string(e.Content), true
		}
	}
	if !found {
		return nil, fmt.Errorf("mise.lock is required")
	}
	config, selected, err := preparationTools(lock)
	if err != nil {
		return nil, err
	}
	return []entry{
		{Path: "mise.lock", Mode: "100644", Blob: contentIdentity([]byte(selected)), Content: []byte(selected)},
		{Path: "mise.toml", Mode: "100644", Blob: contentIdentity([]byte(config)), Content: []byte(config)},
	}, nil
}

func preparationTools(lock string) (string, string, error) {
	var config, selected strings.Builder
	config.WriteString("[settings]\nlockfile = true\n[tools]\n")
	selected.WriteString("lockfile_version = 3\n")
	seen := map[string]bool{}
	for _, block := range strings.Split(lock, "[[tools.")[1:] {
		name, body, ok := strings.Cut(block, "]]\n")
		if !ok || (name != "go" && name != "node" && name != "pnpm") {
			continue
		}
		if seen[name] {
			return "", "", fmt.Errorf("multiple locked versions for %s are unsupported", name)
		}
		lines := strings.Split(body, "\n")
		version := ""
		for _, line := range lines {
			if value, ok := strings.CutPrefix(line, "version = "); ok {
				var err error
				version, err = strconv.Unquote(value)
				if err != nil || version == "" {
					return "", "", fmt.Errorf("invalid locked version for %s", name)
				}
				break
			}
		}
		if version == "" {
			return "", "", fmt.Errorf("missing locked version for %s", name)
		}
		seen[name] = true
		fmt.Fprintf(&config, "%s = %q\n", name, version)
		fmt.Fprintf(&selected, "\n[[tools.%s]]\n", name)
		for _, line := range lines {
			if strings.HasPrefix(line, "specifiers = ") {
				line = fmt.Sprintf("specifiers = [%q]", version)
			}
			selected.WriteString(line + "\n")
		}
	}
	if len(seen) != 3 {
		return "", "", fmt.Errorf("mise.lock must pin go, node and pnpm")
	}
	return config.String(), selected.String(), nil
}

// objectStore writes each distinct file once; context trees hardlink to it.
// Build contexts are only read (BuildKit copies them), so sharing inodes is
// safe. Host groups, which write into their trees, keep private copies.
type objectStore struct{ dir string }

func (o objectStore) materialize(dir string, entries []entry) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(o.dir, 0700); err != nil {
		return err
	}
	sorted := append([]entry{}, entries...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })
	for _, e := range sorted {
		dest := filepath.Join(dir, filepath.FromSlash(e.Path))
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		if e.Mode == "120000" {
			target := string(e.Content)
			if err := validateLink(e.Path, target); err != nil {
				return err
			}
			if err := os.Symlink(target, dest); err != nil {
				return err
			}
			continue
		}
		mode := os.FileMode(0644)
		if e.Mode == "100755" {
			mode = 0755
		}
		object := filepath.Join(o.dir, contentIdentity(e.Content)+"-"+e.Mode)
		if _, err := os.Lstat(object); os.IsNotExist(err) {
			temp, err := os.CreateTemp(o.dir, ".object-")
			if err != nil {
				return err
			}
			_, writeErr := temp.Write(e.Content)
			closeErr := temp.Close()
			if writeErr == nil {
				writeErr = closeErr
			}
			if writeErr == nil {
				writeErr = os.Chmod(temp.Name(), mode)
			}
			if writeErr == nil {
				writeErr = os.Rename(temp.Name(), object)
			}
			if writeErr != nil {
				os.Remove(temp.Name())
				return writeErr
			}
		} else if err != nil {
			return err
		}
		if err := os.Link(object, dest); err != nil {
			return err
		}
	}
	return nil
}
