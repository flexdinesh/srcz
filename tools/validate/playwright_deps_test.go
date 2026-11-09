//go:build linux || darwin

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The image's base stage lists Playwright's Debian 12 packages by hand so all
// apt work stays in one stage. A Playwright bump that needs more fails here.
func TestPlaywrightPackagesCoverLockedPlaywright(t *testing.T) {
	root := repositoryRoot(t)
	var manifest struct {
		DevDependencies map[string]string `json:"devDependencies"`
	}
	raw, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	version := manifest.DevDependencies["@playwright/test"]
	if version == "" {
		t.Fatal("package.json must pin @playwright/test")
	}
	bundle := filepath.Join(root, "node_modules", ".pnpm", "playwright-core@"+version, "node_modules", "playwright-core", "lib", "coreBundle.js")
	source, err := os.ReadFile(bundle)
	if err != nil {
		t.Fatalf("read locked playwright-core (install dependencies first): %v", err)
	}
	text := string(source)
	start := strings.Index(text, `"debian12-x64": {`)
	if start < 0 {
		t.Fatal("playwright-core lacks debian12-x64 dependencies")
	}
	block := text[start:]
	if end := strings.Index(block, "lib2package"); end > 0 {
		block = block[:end]
	}
	dockerfile, err := os.ReadFile("Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	installed := map[string]bool{}
	for _, word := range strings.Fields(strings.ReplaceAll(string(dockerfile), "\\", " ")) {
		installed[word] = true
	}
	checked := 0
	for _, list := range []string{"tools", "chromium", "webkit"} {
		match := regexp.MustCompile(`(?s)\b` + list + `: \[(.*?)\]`).FindStringSubmatch(block)
		if match == nil {
			t.Fatalf("playwright-core debian12-x64 lacks %s", list)
		}
		for _, item := range regexp.MustCompile(`"([^"]+)"`).FindAllStringSubmatch(match[1], -1) {
			checked++
			if !installed[item[1]] {
				t.Errorf("Dockerfile base lacks Playwright %s package %s", list, item[1])
			}
		}
	}
	if checked < 50 {
		t.Fatalf("parsed only %d packages; the bundle format changed", checked)
	}
}
