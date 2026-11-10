package feedback

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// ErrNotFound is returned for feedback the store does not hold.
var ErrNotFound = errors.New("feedback not found")

// repositoryLock names the lock serializing creation and eviction within a
// repository's directory.
const repositoryLock = "repository.lock"

// DefaultDirectory returns the per-user state directory feedback is stored
// in: $XDG_STATE_HOME/zero/feedback (default ~/.local/state) on Linux and
// other Unix systems, ~/Library/Application Support/zero/feedback on macOS.
func DefaultDirectory() (string, error) {
	return defaultDirectory(runtime.GOOS, os.Getenv, os.UserHomeDir, os.UserConfigDir)
}

func defaultDirectory(goos string, getenv func(string) string, home, config func() (string, error)) (string, error) {
	switch goos {
	case "darwin":
		directory, err := home()
		if err != nil {
			return "", fmt.Errorf("locate home: %w", err)
		}
		return filepath.Join(directory, "Library", "Application Support", "zero", "feedback"), nil
	case "windows", "plan9":
		directory, err := config()
		if err != nil {
			return "", fmt.Errorf("locate user config: %w", err)
		}
		return filepath.Join(directory, "zero", "feedback"), nil
	}
	if state := getenv("XDG_STATE_HOME"); filepath.IsAbs(state) {
		return filepath.Join(state, "zero", "feedback"), nil
	}
	directory, err := home()
	if err != nil {
		return "", fmt.Errorf("locate home: %w", err)
	}
	return filepath.Join(directory, ".local", "state", "zero", "feedback"), nil
}

// Store keeps feedback as private JSON files, one directory per repository
// named by the SHA-256 of its key, never inside the project. Writes replace
// files atomically under a per-ID file lock, so processes sharing the
// directory (the CLI and a server) never lose each other's changes; creation
// and eviction also hold the repository's lock. Listing decodes only files
// changed since the last listing.
type Store struct {
	directory string
	limit     int

	mu        sync.Mutex
	summaries map[string]cachedSummary
}

type cachedSummary struct {
	modified time.Time
	size     int64
	summary  Summary
}

// NewStore returns a store rooted at directory that keeps at most
// MaxPerRepository feedbacks per repository.
func NewStore(directory string) *Store {
	return &Store{directory: directory, limit: MaxPerRepository, summaries: map[string]cachedSummary{}}
}

func (s *Store) repositoryDirectory(repository string) string {
	sum := sha256.Sum256([]byte(repository))
	return filepath.Join(s.directory, hex.EncodeToString(sum[:]))
}

func (s *Store) file(repository, id string) string {
	return filepath.Join(s.repositoryDirectory(repository), id+".json")
}

// List returns a repository's feedback, most recently updated first.
func (s *Store) List(repository string) ([]Summary, error) {
	directory := s.repositoryDirectory(repository)
	entries, err := os.ReadDir(directory)
	if errors.Is(err, fs.ErrNotExist) {
		return []Summary{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list feedback: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	summaries := make([]Summary, 0, len(entries))
	for _, entry := range entries {
		id, ok := strings.CutSuffix(entry.Name(), ".json")
		if !ok || !entry.Type().IsRegular() || !idPattern.MatchString(id) {
			continue
		}
		name := filepath.Join(directory, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		cached, ok := s.summaries[name]
		if !ok || !cached.modified.Equal(info.ModTime()) || cached.size != info.Size() {
			f, err := readFeedback(name)
			if err != nil || f.Repository != repository || f.ID != id {
				// Unreadable or foreign files are skipped, not fatal.
				continue
			}
			cached = cachedSummary{modified: info.ModTime(), size: info.Size(), summary: summarize(f)}
			s.summaries[name] = cached
		}
		summaries = append(summaries, cached.summary)
	}
	sort.SliceStable(summaries, func(a, b int) bool {
		if !summaries[a].UpdatedAt.Equal(summaries[b].UpdatedAt) {
			return summaries[a].UpdatedAt.After(summaries[b].UpdatedAt)
		}
		return summaries[a].ID < summaries[b].ID
	})
	return summaries, nil
}

// Get returns a repository's feedback by ID.
func (s *Store) Get(repository, id string) (Feedback, error) {
	if !idPattern.MatchString(id) {
		return Feedback{}, ErrNotFound
	}
	return s.read(repository, id)
}

func (s *Store) read(repository, id string) (Feedback, error) {
	f, err := readFeedback(s.file(repository, id))
	if errors.Is(err, fs.ErrNotExist) {
		return Feedback{}, ErrNotFound
	}
	if err != nil {
		return Feedback{}, err
	}
	if f.Repository != repository || f.ID != id {
		return Feedback{}, ErrNotFound
	}
	return f, nil
}

// Find returns a repository branch's feedback.
func (s *Store) Find(repository, branch string) (Feedback, error) {
	summaries, err := s.List(repository)
	if err != nil {
		return Feedback{}, err
	}
	for _, summary := range summaries {
		if summary.Branch == branch {
			return s.read(repository, summary.ID)
		}
	}
	return Feedback{}, ErrNotFound
}

// Locate returns the feedback with ID in any repository.
func (s *Store) Locate(id string) (Feedback, error) {
	if !idPattern.MatchString(id) {
		return Feedback{}, ErrNotFound
	}
	entries, err := os.ReadDir(s.directory)
	if errors.Is(err, fs.ErrNotExist) {
		return Feedback{}, ErrNotFound
	}
	if err != nil {
		return Feedback{}, fmt.Errorf("locate feedback: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		f, err := readFeedback(filepath.Join(s.directory, entry.Name(), id+".json"))
		if err == nil && f.ID == id && filepath.Base(s.repositoryDirectory(f.Repository)) == entry.Name() {
			return f, nil
		}
	}
	return Feedback{}, ErrNotFound
}

// taken reports whether any repository holds a file for id.
func (s *Store) taken(id string) (bool, error) {
	entries, err := os.ReadDir(s.directory)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		if _, err := os.Lstat(filepath.Join(s.directory, entry.Name(), id+".json")); err == nil {
			return true, nil
		}
	}
	return false, nil
}

// Ensure returns a repository branch's feedback, creating it empty with an
// ID from newID (retried while taken) when there is none, then evicting the
// least recently updated past the repository's limit.
func (s *Store) Ensure(repository, branch, project string, now time.Time, newID func() (string, error)) (Feedback, error) {
	directory := s.repositoryDirectory(repository)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return Feedback{}, fmt.Errorf("create feedback directory: %w", err)
	}
	unlock, err := lockFile(filepath.Join(directory, repositoryLock))
	if err != nil {
		return Feedback{}, err
	}
	defer unlock()
	if existing, err := s.Find(repository, branch); !errors.Is(err, ErrNotFound) {
		return existing, err
	}
	var id string
	for attempt := 0; ; attempt++ {
		if id, err = newID(); err != nil {
			return Feedback{}, err
		}
		taken, err := s.taken(id)
		if err != nil {
			return Feedback{}, err
		}
		if !taken {
			break
		}
		if attempt == 16 {
			return Feedback{}, errors.New("no free feedback ID")
		}
	}
	f := Feedback{ID: id, Repository: repository, Branch: branch, Project: project, NextThread: 1, Threads: []Thread{}, CreatedAt: now, UpdatedAt: now}
	if err := s.write(f); err != nil {
		return Feedback{}, err
	}
	if err := s.evict(repository, id); err != nil {
		return f, err
	}
	return f, nil
}

// Update changes a repository's feedback under its lock: change sees the
// stored feedback and edits it in place; its error leaves the file as it
// was. It returns the stored result.
func (s *Store) Update(repository, id string, change func(*Feedback) error) (Feedback, error) {
	if !idPattern.MatchString(id) {
		return Feedback{}, ErrNotFound
	}
	directory := s.repositoryDirectory(repository)
	if _, err := os.Stat(directory); err != nil {
		return Feedback{}, ErrNotFound
	}
	unlock, err := lockFile(filepath.Join(directory, id+".lock"))
	if err != nil {
		return Feedback{}, err
	}
	defer unlock()
	f, err := s.read(repository, id)
	if err != nil {
		return Feedback{}, err
	}
	if err := change(&f); err != nil {
		return Feedback{}, err
	}
	if err := s.write(f); err != nil {
		return Feedback{}, err
	}
	return f, nil
}

// Delete removes a repository's feedback by ID.
func (s *Store) Delete(repository, id string) error {
	if !idPattern.MatchString(id) {
		return ErrNotFound
	}
	directory := s.repositoryDirectory(repository)
	if _, err := os.Stat(directory); err != nil {
		return ErrNotFound
	}
	return s.remove(repository, id)
}

// remove deletes a feedback's file under its lock, then the lock file.
func (s *Store) remove(repository, id string) error {
	lock := filepath.Join(s.repositoryDirectory(repository), id+".lock")
	unlock, err := lockFile(lock)
	if err != nil {
		return err
	}
	defer unlock()
	if _, err := s.read(repository, id); err != nil {
		return err
	}
	name := s.file(repository, id)
	err = os.Remove(name)
	s.mu.Lock()
	delete(s.summaries, name)
	s.mu.Unlock()
	if errors.Is(err, fs.ErrNotExist) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("delete feedback: %w", err)
	}
	_ = os.Remove(lock)
	return nil
}

// evict removes the least recently updated feedback past the limit, never
// keep. The caller holds the repository's lock.
func (s *Store) evict(repository, keep string) error {
	summaries, err := s.List(repository)
	if err != nil {
		return err
	}
	others := make([]Summary, 0, len(summaries))
	for _, summary := range summaries {
		if summary.ID != keep {
			others = append(others, summary)
		}
	}
	for i := s.limit - 1; i < len(others); i++ {
		if err := s.remove(repository, others[i].ID); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}

// write replaces f's file atomically through a private temporary file.
func (s *Store) write(f Feedback) error {
	contents, err := json.Marshal(f)
	if err != nil {
		return fmt.Errorf("encode feedback: %w", err)
	}
	name := s.file(f.Repository, f.ID)
	file, err := os.CreateTemp(filepath.Dir(name), ".feedback-*")
	if err != nil {
		return fmt.Errorf("write feedback: %w", err)
	}
	temporary := file.Name()
	defer func() { _ = os.Remove(temporary) }()
	if _, err := file.Write(contents); err != nil {
		_ = file.Close()
		return fmt.Errorf("write feedback: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return fmt.Errorf("write feedback: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("write feedback: %w", err)
	}
	if err := os.Rename(temporary, name); err != nil {
		return fmt.Errorf("write feedback: %w", err)
	}
	return nil
}

func readFeedback(name string) (Feedback, error) {
	contents, err := os.ReadFile(name)
	if err != nil {
		return Feedback{}, err
	}
	var f Feedback
	if err := json.Unmarshal(contents, &f); err != nil {
		return Feedback{}, fmt.Errorf("read feedback %s: %w", filepath.Base(name), err)
	}
	return f, nil
}
