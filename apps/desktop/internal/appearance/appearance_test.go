package appearance

import (
	"image/color"
	"os"
	"path/filepath"
	"testing"
)

func TestHexKeepsOnlyOpaqueColors(t *testing.T) {
	if got, ok := Hex(color.NRGBA{R: 0x1e, G: 0x1e, B: 0x2e, A: 0xff}); !ok || got != "#1e1e2e" {
		t.Fatalf("Hex(opaque) = %q, %v", got, ok)
	}
	if _, ok := Hex(color.NRGBA{R: 1, G: 2, B: 3, A: 0x80}); ok {
		t.Fatal("Hex accepted a translucent color")
	}
}

func TestWindowBackgroundFallsBackToTheDefault(t *testing.T) {
	if got := (Look{}).WindowBackground(); got != DefaultBackground {
		t.Fatalf("empty look background = %q", got)
	}
	if got := (Look{Background: "#101019"}).WindowBackground(); got != "#101019" {
		t.Fatalf("remembered background = %q", got)
	}
}

func TestStoreRemembersLooksAcrossOpens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "zero-desktop", "appearance.json")
	store := Open(path)
	if err := store.SetBackground("local", "#101019"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAppearance("local", Dark); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAppearance("r-0123456789ab", System); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("store mode = %v, want 0600", mode)
	}
	reopened := Open(path)
	if got := reopened.Get("local"); got != (Look{Background: "#101019", Appearance: Dark}) {
		t.Fatalf("local look = %+v", got)
	}
	if got := reopened.Get("r-0123456789ab"); got != (Look{Appearance: System}) {
		t.Fatalf("remote look = %+v", got)
	}
}

func TestStoreRefusesInvalidValues(t *testing.T) {
	store := Open("")
	for _, background := range []string{"", "red", "#FFF", "#1E1E2E", "#1e1e2eff", "rgb(0 0 0)"} {
		if store.SetBackground("local", background) == nil {
			t.Errorf("SetBackground(%q) accepted", background)
		}
	}
	for _, source := range []string{"", "auto", "Dark", "dracula"} {
		if store.SetAppearance("local", source) == nil {
			t.Errorf("SetAppearance(%q) accepted", source)
		}
	}
	if got := store.Get("local"); got != (Look{}) {
		t.Fatalf("look after refusals = %+v", got)
	}
}

func TestOpenDropsInvalidEntriesAndToleratesBadFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "appearance.json")
	content := `{"local":{"background":"#101019","appearance":"dark"},"bad":{"background":"red"},"worse":{"appearance":"auto"},"":{"appearance":"dark"}}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	store := Open(path)
	if got := store.Get("local"); got != (Look{Background: "#101019", Appearance: Dark}) {
		t.Fatalf("valid entry = %+v", got)
	}
	for _, host := range []string{"bad", "worse", ""} {
		if got := store.Get(host); got != (Look{}) {
			t.Errorf("invalid entry %q kept: %+v", host, got)
		}
	}
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Open(path).Get("local"); got != (Look{}) {
		t.Fatalf("corrupt file look = %+v", got)
	}
	if got := Open(filepath.Join(dir, "missing.json")).Get("local"); got != (Look{}) {
		t.Fatalf("missing file look = %+v", got)
	}
}
