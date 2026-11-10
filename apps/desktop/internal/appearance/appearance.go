// Package appearance keeps each connection window's look (decision 0119): the
// background its page reports through its theme-color meta and the polarity it
// asks native surfaces to take, remembered so the next launch opens in them.
// It knows no mygo; pages are untrusted, so only opaque colors and the three
// sources are kept.
package appearance

import (
	"encoding/json"
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// DefaultBackground fills a window whose page has told no color yet: the zero
// canvas in either OS polarity.
const DefaultBackground = "light-dark(#d7d8dc, #101116)"

// Sources native surfaces follow: the OS's polarity, or one.
const (
	System = "system"
	Light  = "light"
	Dark   = "dark"
)

// Look is what a connection's window showed last.
type Look struct {
	// Background is #rrggbb, or "" when none was told.
	Background string `json:"background,omitempty"`
	// Appearance is System, Light, Dark, or "" when none was told.
	Appearance string `json:"appearance,omitempty"`
}

var hexColor = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// IsSource reports one of the three sources.
func IsSource(s string) bool { return s == System || s == Light || s == Dark }

// Hex is an opaque color as #rrggbb; translucent colors are refused.
func Hex(c color.NRGBA) (string, bool) {
	if c.A != 0xff {
		return "", false
	}
	return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B), true
}

// WindowBackground is the color a window opens with: the one remembered, else the
// default.
func (l Look) WindowBackground() string {
	if l.Background == "" {
		return DefaultBackground
	}
	return l.Background
}

// Store remembers looks by connection host in one JSON file (0600). A missing
// or unreadable file is an empty store; an empty path keeps looks in memory.
type Store struct {
	path  string
	mu    sync.Mutex
	looks map[string]Look
}

// Open reads the store at path, dropping entries that are not valid.
func Open(path string) *Store {
	s := &Store{path: path, looks: map[string]Look{}}
	if path == "" {
		return s
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	var saved map[string]Look
	if json.Unmarshal(data, &saved) != nil {
		return s
	}
	for host, look := range saved {
		if host == "" || (look.Background != "" && !hexColor.MatchString(look.Background)) || (look.Appearance != "" && !IsSource(look.Appearance)) {
			continue
		}
		s.looks[host] = look
	}
	return s
}

// Get returns host's look; the zero Look when none is remembered.
func (s *Store) Get(host string) Look {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.looks[host]
}

// SetBackground remembers host's background, #rrggbb.
func (s *Store) SetBackground(host, background string) error {
	if !hexColor.MatchString(background) {
		return fmt.Errorf("appearance: invalid background %q", background)
	}
	return s.update(host, func(look *Look) { look.Background = background })
}

// SetAppearance remembers host's source.
func (s *Store) SetAppearance(host, source string) error {
	if !IsSource(source) {
		return fmt.Errorf("appearance: invalid source %q", source)
	}
	return s.update(host, func(look *Look) { look.Appearance = source })
}

func (s *Store) update(host string, change func(*Look)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	look := s.looks[host]
	before := look
	change(&look)
	if look == before {
		return nil
	}
	s.looks[host] = look
	return s.save()
}

// save writes the looks atomically. Callers hold mu.
func (s *Store) save() error {
	if s.path == "" {
		return nil
	}
	data, err := json.Marshal(s.looks)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".appearance-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), s.path)
}
