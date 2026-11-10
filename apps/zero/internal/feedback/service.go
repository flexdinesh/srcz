package feedback

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"slices"
	"time"
)

// ErrFull wraps a write past a limit: threads per feedback or messages per
// thread.
var ErrFull = errors.New("feedback is full")

// idAlphabet is lowercase base32 (RFC 4648).
const idAlphabet = "abcdefghijklmnopqrstuvwxyz234567"

// Service reads and changes feedback. Every transport (HTTP, in process, the
// CLI) goes through it.
type Service struct {
	store  *Store
	now    func() time.Time
	random io.Reader
}

// NewService returns a service over store.
func NewService(store *Store) *Service {
	return &Service{store: store, now: time.Now, random: rand.Reader}
}

// Target names the feedback a new thread joins: ID's in Repository, or else
// Branch's, created when missing. Project is the writer's directory.
type Target struct {
	Repository string
	Branch     string
	ID         string
	Project    string
}

// NewThread is a thread's anchor and first message. Name is an agent's own
// name.
type NewThread struct {
	Anchor Anchor
	Author string
	Name   string
	Body   string
}

// NewMessage is a reply, a status change, or both, to thread Thread. A user
// message without a status reopens a closed thread.
type NewMessage struct {
	Thread int
	Author string
	Name   string
	Body   string
	Status string
}

// List returns a repository's feedback, most recently updated first.
func (s *Service) List(repository string) ([]Summary, error) { return s.store.List(repository) }

// Get returns a repository's feedback by ID, or ErrNotFound.
func (s *Service) Get(repository, id string) (Feedback, error) { return s.store.Get(repository, id) }

// Find returns a repository branch's feedback, or ErrNotFound.
func (s *Service) Find(repository, branch string) (Feedback, error) {
	return s.store.Find(repository, branch)
}

// Locate returns the feedback with ID in any repository, or ErrNotFound.
func (s *Service) Locate(id string) (Feedback, error) { return s.store.Locate(id) }

// Delete removes a repository's feedback, or returns ErrNotFound.
func (s *Service) Delete(repository, id string) error { return s.store.Delete(repository, id) }

// AddThread starts a thread in target's feedback, creating the feedback for
// the branch when target names no ID. It returns the stored feedback and the
// new thread.
func (s *Service) AddThread(target Target, thread NewThread) (Feedback, Thread, error) {
	now := s.now().UTC()
	id := target.ID
	if id == "" {
		created, err := s.store.Ensure(target.Repository, target.Branch, target.Project, now, s.newID)
		if err != nil {
			return Feedback{}, Thread{}, err
		}
		id = created.ID
	}
	var added Thread
	stored, err := s.store.Update(target.Repository, id, func(f *Feedback) error {
		if len(f.Threads) >= MaxThreads {
			return fmt.Errorf("%w: feedback %s has %d threads, the most it may hold", ErrFull, f.ID, MaxThreads)
		}
		added = Thread{
			Number:    max(f.NextThread, 1),
			Status:    StatusOpen,
			Anchor:    thread.Anchor,
			Messages:  []Message{{Number: 1, Author: thread.Author, Name: thread.Name, Body: thread.Body, CreatedAt: now}},
			CreatedAt: now,
			UpdatedAt: now,
		}
		f.NextThread = added.Number + 1
		f.Threads = append(f.Threads, added)
		f.Project = target.Project
		f.UpdatedAt = now
		return nil
	})
	if err != nil {
		return Feedback{}, Thread{}, err
	}
	return stored, added, nil
}

// AddMessage adds a message to a thread of repository's feedback id and
// applies its status: a given status is set (open reopens); a user message
// without one reopens a closed thread and records that it did. A thread the
// feedback lacks is a Problems error.
func (s *Service) AddMessage(repository, id, project string, message NewMessage) (Feedback, Thread, error) {
	now := s.now().UTC()
	var changed Thread
	stored, err := s.store.Update(repository, id, func(f *Feedback) error {
		index := slices.IndexFunc(f.Threads, func(thread Thread) bool { return thread.Number == message.Thread })
		if index < 0 {
			return Problems{{Field: "thread", Message: fmt.Sprintf("feedback %s has no thread %d", f.ID, message.Thread)}}
		}
		thread := &f.Threads[index]
		if len(thread.Messages) >= MaxMessages {
			return fmt.Errorf("%w: thread %d has %d messages, the most it may hold", ErrFull, thread.Number, MaxMessages)
		}
		status := message.Status
		if status == "" && message.Author == AuthorUser && thread.Status != StatusOpen {
			status = StatusOpen
		}
		if status != "" {
			thread.Status = status
		}
		thread.Messages = append(thread.Messages, Message{Number: len(thread.Messages) + 1, Author: message.Author, Name: message.Name, Body: message.Body, Status: status, CreatedAt: now})
		thread.UpdatedAt = now
		f.Project = project
		f.UpdatedAt = now
		changed = *thread
		return nil
	})
	if err != nil {
		return Feedback{}, Thread{}, err
	}
	return stored, changed, nil
}

// DeleteThread removes a thread of repository's feedback id; its number is
// never reused. A thread the feedback lacks is a Problems error.
func (s *Service) DeleteThread(repository, id string, number int) (Feedback, error) {
	now := s.now().UTC()
	return s.store.Update(repository, id, func(f *Feedback) error {
		index := slices.IndexFunc(f.Threads, func(thread Thread) bool { return thread.Number == number })
		if index < 0 {
			return Problems{{Field: "thread", Message: fmt.Sprintf("feedback %s has no thread %d", f.ID, number)}}
		}
		f.Threads = slices.Delete(f.Threads, index, index+1)
		f.UpdatedAt = now
		return nil
	})
}

// newID is fb- and six random lowercase base32 characters.
func (s *Service) newID() (string, error) {
	var random [4]byte
	if _, err := io.ReadFull(s.random, random[:]); err != nil {
		return "", err
	}
	value := binary.BigEndian.Uint32(random[:])
	id := make([]byte, 0, 9)
	id = append(id, "fb-"...)
	for range 6 {
		id = append(id, idAlphabet[value&31])
		value >>= 5
	}
	return string(id), nil
}
