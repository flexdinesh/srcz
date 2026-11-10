// Package feedback owns review feedback threads (decision 0120): one feedback
// per repository and branch, holding threads of user and agent messages,
// each anchored to lines of a file side. It validates drafts, captures and
// re-anchors line anchors by content, and stores feedback in the user's
// state directory behind a Service every transport shares. It knows no HTTP
// and no git: internal/app reads file sides and maps the model to contracts.
package feedback

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Limits bound what feedback may hold (decision 0120).
const (
	// MaxRequestBytes bounds one encoded draft.
	MaxRequestBytes = 1 << 20
	// MaxThreads bounds one feedback's threads.
	MaxThreads = 500
	// MaxMessages bounds one thread's messages.
	MaxMessages = 100
	// MaxBodyBytes bounds one message body.
	MaxBodyBytes = 16 << 10
	// MaxPerRepository bounds the feedback stored for one repository; the
	// least recently updated is evicted past it.
	MaxPerRepository = 200
	// MaxNameLength bounds an agent's name, in characters.
	MaxNameLength = 64
)

// Authors name who wrote a message.
const (
	AuthorUser  = "user"
	AuthorAgent = "agent"
)

// Statuses are a thread's states.
const (
	StatusOpen     = "open"
	StatusResolved = "resolved"
	StatusWontfix  = "wontfix"
)

// Sides name which side's lines an anchor uses.
const (
	SideNew = "new"
	SideOld = "old"
)

// Compare kinds name the compare a thread was written in.
const (
	CompareWorking = "working"
	CompareBranch  = "branch"
	CompareCommit  = "commit"
	CompareRange   = "range"
)

// Awaiting names who a thread waits on.
const (
	AwaitingNone  = "none"
	AwaitingAgent = "agent"
	AwaitingUser  = "user"
)

// Feedback is one repository branch's stored threads. Repository is the
// key's repository (its common git directory, or a folder's own directory);
// Branch is "" for a detached HEAD or a folder. Project is the directory of
// the last write, where locations resolve when no project is named.
type Feedback struct {
	ID         string    `json:"id"`
	Repository string    `json:"repository"`
	Branch     string    `json:"branch"`
	Project    string    `json:"project"`
	NextThread int       `json:"nextThread"`
	Threads    []Thread  `json:"threads"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// Thread is one conversation at an anchor. Numbers count from 1 within the
// feedback and are never reused.
type Thread struct {
	Number    int       `json:"number"`
	Status    string    `json:"status"`
	Anchor    Anchor    `json:"anchor"`
	Messages  []Message `json:"messages"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Awaiting derives who the thread waits on: the agent when it is open and
// the user wrote last, the user when the agent wrote last, else nobody.
func (t Thread) Awaiting() string {
	if len(t.Messages) == 0 {
		return AwaitingNone
	}
	switch last := t.Messages[len(t.Messages)-1]; {
	case last.Author == AuthorAgent:
		return AwaitingUser
	case t.Status == StatusOpen:
		return AwaitingAgent
	}
	return AwaitingNone
}

// Message is one message of a thread. Status is the status it set, if any.
type Message struct {
	Number    int       `json:"number"`
	Author    string    `json:"author"`
	Name      string    `json:"name,omitempty"`
	Body      string    `json:"body"`
	Status    string    `json:"status,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Lines is an inclusive, 1-based line range.
type Lines [2]int

// Anchor is where a thread was written: Path on Side, optionally Lines, the
// anchored Text with up to ContextLines of Before and After, the side's Blob
// hash, and the Compare it was written in (nil for Source).
type Anchor struct {
	Path    string   `json:"path"`
	Side    string   `json:"side"`
	Lines   *Lines   `json:"lines,omitempty"`
	Text    []string `json:"text,omitempty"`
	Before  []string `json:"before,omitempty"`
	After   []string `json:"after,omitempty"`
	Blob    string   `json:"blob,omitempty"`
	Compare *Compare `json:"compare,omitempty"`
}

// Compare names a Source Control compare: working, branch (Base to Head,
// optionally with uncommitted changes), commit (against its first parent),
// or range (From's parent to To). Hashes are full.
type Compare struct {
	Kind        string `json:"kind"`
	Base        string `json:"base,omitempty"`
	Head        string `json:"head,omitempty"`
	Uncommitted bool   `json:"uncommitted"`
	Commit      string `json:"commit,omitempty"`
	From        string `json:"from,omitempty"`
	To          string `json:"to,omitempty"`
}

// Summary lists one feedback without its threads.
type Summary struct {
	ID            string
	Branch        string
	Threads       int
	Open          int
	AwaitingAgent int
	AwaitingUser  int
	UpdatedAt     time.Time
}

func summarize(f Feedback) Summary {
	summary := Summary{ID: f.ID, Branch: f.Branch, Threads: len(f.Threads), UpdatedAt: f.UpdatedAt}
	for _, thread := range f.Threads {
		if thread.Status == StatusOpen {
			summary.Open++
		}
		switch thread.Awaiting() {
		case AwaitingAgent:
			summary.AwaitingAgent++
		case AwaitingUser:
			summary.AwaitingUser++
		}
	}
	return summary
}

// Problem is one reason a draft was rejected, at a JSON field such as
// compare.commit.
type Problem struct {
	Field   string
	Message string
}

// Problems is a rejected draft's every problem.
type Problems []Problem

func (p Problems) Error() string {
	messages := make([]string, len(p))
	for i, problem := range p {
		messages[i] = problem.Field + ": " + problem.Message
	}
	return "invalid feedback: " + strings.Join(messages, "; ")
}

// ErrInvalidJSON wraps a draft that is not one strict JSON object.
var ErrInvalidJSON = errors.New("invalid feedback JSON")

// Decode reads one JSON object into draft strictly: unknown fields and
// trailing data are rejected. Errors wrap the reader's, so a transport can
// tell a body over its limit.
func Decode(r io.Reader, draft any) error {
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(draft); err != nil {
		return fmt.Errorf("%w: %w", ErrInvalidJSON, err)
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: data after the object", ErrInvalidJSON)
	}
	return nil
}

var (
	idPattern   = regexp.MustCompile(`^fb-[a-z0-9]{6}$`)
	hashPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// ValidID reports whether id is a feedback ID: fb- and six lowercase letters
// or digits. New IDs use base32's (a–z, 2–7); reads accept any.
func ValidID(id string) bool { return idPattern.MatchString(id) }

// ThreadDraft is a new thread with its first message. Project is an
// absolute directory; ID is optional. Author has a transport's default
// applied before Normalize.
type ThreadDraft struct {
	Project string
	ID      string
	Compare *Compare
	Path    string
	Side    string
	Lines   []int
	Body    string
	Author  string
	Name    string
}

// MessageDraft is a reply to thread Thread of feedback ID, a status change,
// or both.
type MessageDraft struct {
	Project string
	ID      string
	Thread  int
	Body    string
	Status  string
	Author  string
	Name    string
}

type addProblem func(field, format string, args ...any)

func collector(problems *Problems) addProblem {
	return func(field, format string, args ...any) {
		*problems = append(*problems, Problem{Field: field, Message: fmt.Sprintf(format, args...)})
	}
}

// Normalize trims text, lowercases hashes, and defaults the side to new,
// then checks the draft's structure. Paths and lines are not checked
// against the project.
func (d ThreadDraft) Normalize() (ThreadDraft, error) {
	d.Project = strings.TrimSpace(d.Project)
	d.ID = strings.TrimSpace(d.ID)
	d.Path = strings.TrimSpace(d.Path)
	d.Body = strings.TrimSpace(d.Body)
	d.Name = strings.TrimSpace(d.Name)
	if d.Side == "" {
		d.Side = SideNew
	}
	if d.Compare != nil {
		compare := d.Compare.normalize()
		d.Compare = &compare
	}
	var problems Problems
	add := collector(&problems)
	checkProject(add, d.Project)
	checkID(add, d.ID, false)
	if d.Compare != nil {
		checkCompare(add, "compare", *d.Compare)
	}
	checkPath(add, "path", d.Path)
	switch {
	case d.Side != SideNew && d.Side != SideOld:
		add("side", `must be "new" or "old"`)
	case d.Side == SideOld && d.Compare == nil:
		add("side", "is old, which needs a compare; Source threads use the new side")
	}
	if d.Lines != nil {
		switch {
		case len(d.Lines) != 2:
			add("lines", "must be [start, end], got %d numbers", len(d.Lines))
		case d.Lines[0] < 1:
			add("lines", "start must be at least 1")
		case d.Lines[1] < d.Lines[0]:
			add("lines", "end %d is before start %d", d.Lines[1], d.Lines[0])
		}
	}
	checkBody(add, d.Body, true)
	checkAuthor(add, d.Author, d.Name)
	if len(problems) > 0 {
		return d, problems
	}
	return d, nil
}

// LinesRange returns the draft's lines as a range, nil for a file-level
// thread. Call it on a normalized draft.
func (d ThreadDraft) LinesRange() *Lines {
	if len(d.Lines) != 2 {
		return nil
	}
	return &Lines{d.Lines[0], d.Lines[1]}
}

// Normalize trims text, then checks the draft's structure.
func (d MessageDraft) Normalize() (MessageDraft, error) {
	d.Project = strings.TrimSpace(d.Project)
	d.ID = strings.TrimSpace(d.ID)
	d.Body = strings.TrimSpace(d.Body)
	d.Name = strings.TrimSpace(d.Name)
	var problems Problems
	add := collector(&problems)
	checkProject(add, d.Project)
	checkID(add, d.ID, true)
	if d.Thread < 1 {
		add("thread", "is required: a thread number from 1")
	}
	switch d.Status {
	case "", StatusOpen, StatusResolved, StatusWontfix:
	default:
		add("status", `must be "open", "resolved", or "wontfix"`)
	}
	checkBody(add, d.Body, d.Status == "")
	checkAuthor(add, d.Author, d.Name)
	if len(problems) > 0 {
		return d, problems
	}
	return d, nil
}

func (c Compare) normalize() Compare {
	c.Kind = strings.TrimSpace(c.Kind)
	c.Base = strings.TrimSpace(c.Base)
	c.Head = strings.TrimSpace(c.Head)
	c.Commit = strings.ToLower(strings.TrimSpace(c.Commit))
	c.From = strings.ToLower(strings.TrimSpace(c.From))
	c.To = strings.ToLower(strings.TrimSpace(c.To))
	return c
}

// CheckCompare normalizes a compare and checks its structure, reporting
// problems at compare.<field>.
func CheckCompare(compare Compare) (Compare, error) {
	compare = compare.normalize()
	var problems Problems
	checkCompare(collector(&problems), "compare", compare)
	if len(problems) > 0 {
		return compare, problems
	}
	return compare, nil
}

func checkProject(add addProblem, project string) {
	if project == "" {
		add("project", "is required: the project's absolute directory")
	} else if !filepath.IsAbs(project) {
		add("project", "must be an absolute directory")
	}
}

func checkID(add addProblem, id string, required bool) {
	switch {
	case id == "" && required:
		add("id", "is required: a feedback ID such as fb-3k2q8m")
	case id != "" && !idPattern.MatchString(id):
		add("id", "must be fb- and six lowercase letters or digits, such as fb-3k2q8m")
	}
}

func checkPath(add addProblem, field, name string) {
	if name == "" {
		add(field, "is required")
		return
	}
	if strings.Contains(name, `\`) || path.IsAbs(name) || path.Clean(name) != name || name == "." || name == ".." || strings.HasPrefix(name, "../") {
		add(field, "must be a clean, project-relative path with forward slashes")
	}
}

func checkBody(add addProblem, body string, required bool) {
	switch {
	case body == "" && required:
		add("body", "is required")
	case len(body) > MaxBodyBytes:
		add("body", "is longer than %d bytes", MaxBodyBytes)
	}
}

func checkAuthor(add addProblem, author, name string) {
	switch author {
	case AuthorUser, AuthorAgent:
	default:
		add("author", `must be "user" or "agent"`)
	}
	switch {
	case name == "":
	case author == AuthorUser:
		add("name", "applies to agent messages only")
	case strings.ContainsAny(name, "\r\n") || utf8.RuneCountInString(name) > MaxNameLength:
		add("name", "must be one line of at most %d characters", MaxNameLength)
	}
}

func checkCompare(add addProblem, field string, compare Compare) {
	allowed := map[string]bool{}
	switch compare.Kind {
	case CompareWorking:
	case CompareBranch:
		allowed["base"], allowed["head"] = true, true
	case CompareCommit:
		allowed["commit"] = true
	case CompareRange:
		allowed["from"], allowed["to"] = true, true
	default:
		add(field+".kind", `must be "working", "branch", "commit", or "range"`)
		return
	}
	for _, value := range []struct {
		name, value string
		hash        bool
	}{{"base", compare.Base, false}, {"head", compare.Head, false}, {"commit", compare.Commit, true}, {"from", compare.From, true}, {"to", compare.To, true}} {
		switch {
		case value.value != "" && !allowed[value.name]:
			add(field+"."+value.name, "doesn't apply to a %s compare", compare.Kind)
		case value.hash && allowed[value.name] && value.value == "":
			add(field+"."+value.name, "is required for a %s compare", compare.Kind)
		case value.hash && value.value != "" && !hashPattern.MatchString(value.value):
			add(field+"."+value.name, "must be a full commit hash of 40 hexadecimal digits")
		}
	}
	switch {
	case compare.Uncommitted && compare.Kind != CompareBranch:
		add(field+".uncommitted", "doesn't apply to a %s compare", compare.Kind)
	case compare.Uncommitted && compare.Head != "":
		add(field+".head", "doesn't apply with uncommitted: uncommitted changes are HEAD's")
	}
}
