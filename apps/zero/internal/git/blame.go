package git

import (
	"container/heap"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"

	"github.com/flexdinesh/zero/internal/diff"
)

// Blame walk bounds; variables so tests can lower them.
var (
	// blameLimit caps the commits one blame visits.
	blameLimit = 50_000
	// blameTimeout caps one blame's walk.
	blameTimeout = 10 * time.Second
)

// blameBlobLimit is the largest version a blame reads, decision 0004's
// preview limit: an older version past it shares no lines with its child.
const blameBlobLimit = 4 << 20

// BlameLine attributes one row of the blamed text, as diff.Matches splits
// rows.
type BlameLine struct {
	// Commit indexes Blame.Commits.
	Commit int
	// Line is the 1-based row the line has in that commit's version.
	Line int
	// Boundary reports that the walk stopped at Commit before finding where
	// the line came from: a shallow commit, or the walk's bounds.
	Boundary bool
}

// BlameCommit is a commit a blame credits lines to.
type BlameCommit struct {
	Commit
	// Via is the merge the walk last reached the commit through by a parent
	// other than the first, and ViaSubject its subject; both empty when the
	// commit was reached by first parents only. A pull request merged with a
	// merge commit names the merge rather than its commits.
	Via, ViaSubject string
}

// Blame is who last changed each line of a file's version at a commit.
type Blame struct {
	// Lines has one entry per row of the blamed text.
	Lines   []BlameLine
	Commits []BlameCommit
	// Truncated reports that the walk stopped at its commit or time bound;
	// lines it had not placed are boundary lines.
	Truncated bool
}

// Blame credits each row of content, the file name has at the commit start,
// to the commit that last changed it, as git blame does without following
// renames or copies. It walks history newest committer date first over
// every parent: a line passes to the first parent, in order, that has it
// unchanged (by diff.Matches), and stays with the commit when none does,
// including when a parent lacks the path or its version is over
// blameBlobLimit. A shallow commit's remaining lines are boundary
// lines. The walk stops after blameLimit commits or blameTimeout; lines
// still pending become boundary lines where they were pending. It returns
// ErrUnavailable when the commit is unknown or has no file there.
func (r *Repository) Blame(ctx context.Context, start Hash, name string, content []byte) (Blame, error) {
	if !validPath(name) {
		return Blame{}, ErrUnavailable
	}
	first, err := r.commit(plumbing.Hash(start))
	if err != nil {
		return Blame{}, err
	}
	w, err := r.newWalker(ctx)
	if err != nil {
		return Blame{}, err
	}
	paths := w.filter(LogOptions{Path: name})
	entry, err := paths.entry(first.TreeHash)
	if err != nil {
		return Blame{}, err
	}
	if !entry.Mode.IsFile() {
		return Blame{}, ErrUnavailable
	}
	b := &blamer{
		w:        w,
		paths:    paths,
		queued:   map[plumbing.Hash]*blameItem{},
		credited: map[plumbing.Hash]int{},
		result:   Blame{Lines: make([]BlameLine, diff.Rows(content)), Commits: []BlameCommit{}},
	}
	needs := make([]blameNeed, len(b.result.Lines))
	for i := range needs {
		needs[i] = blameNeed{line: i, result: i}
	}
	if len(needs) == 0 {
		return b.result, nil
	}
	b.push(&blameItem{commit: first, blob: entry.Hash, text: content, loaded: true, needs: needs})
	if err := b.walk(); err != nil {
		return Blame{}, err
	}
	if err := b.subjects(); err != nil {
		return Blame{}, err
	}
	return b.result, nil
}

// blameNeed is a line a commit's version still has to place: its 0-based
// row there and in the blamed text.
type blameNeed struct{ line, result int }

// blameItem is a queued commit and the lines of its version, sorted by
// row, whose origin is not yet known.
type blameItem struct {
	commit *object.Commit
	blob   plumbing.Hash
	// text is the version's content once loaded.
	text   []byte
	loaded bool
	needs  []blameNeed
	via    plumbing.Hash
	order  int
}

type blamer struct {
	w        *walker
	paths    *filter
	queue    blameQueue
	queued   map[plumbing.Hash]*blameItem
	credited map[plumbing.Hash]int
	vias     []plumbing.Hash
	pushed   int
	result   Blame
}

func (b *blamer) walk() error {
	deadline := time.Now().Add(blameTimeout)
	for b.queue.Len() > 0 {
		if err := b.w.ctx.Err(); err != nil {
			return err
		}
		if b.w.steps >= blameLimit || time.Now().After(deadline) {
			b.result.Truncated = true
			for _, item := range b.queue.items {
				b.credit(item.commit, item.via, item.needs, true)
			}
			return nil
		}
		b.w.steps++
		item, _ := heap.Pop(&b.queue).(*blameItem)
		delete(b.queued, item.commit.Hash)
		if err := b.visit(item); err != nil {
			return err
		}
	}
	return nil
}

// visit passes an item's lines to its parents and credits the rest to it.
func (b *blamer) visit(item *blameItem) error {
	if b.w.shallow[item.commit.Hash] && len(item.commit.ParentHashes) > 0 {
		b.credit(item.commit, item.via, item.needs, true)
		return nil
	}
	remaining := item.needs
	cut := false
	for i, hash := range item.commit.ParentHashes {
		if len(remaining) == 0 {
			break
		}
		parent, err := object.GetCommit(b.w.repo.storage, hash)
		if errors.Is(err, plumbing.ErrObjectNotFound) {
			// A history cut without a shallow file ends here too.
			cut = true
			continue
		}
		if err != nil {
			return fmt.Errorf("read commit %s: %w", hash, err)
		}
		entry, err := b.paths.entry(parent.TreeHash)
		if err != nil {
			return err
		}
		if !entry.Mode.IsFile() {
			continue
		}
		via := item.via
		if i > 0 {
			via = item.commit.Hash
		}
		if entry.Hash == item.blob {
			b.pass(&blameItem{commit: parent, blob: entry.Hash, text: item.text, loaded: item.loaded, needs: remaining, via: via})
			remaining = nil
			break
		}
		size, err := b.w.repo.storage.EncodedObjectSize(entry.Hash)
		if err != nil {
			return fmt.Errorf("read blob %s: %w", entry.Hash, err)
		}
		if size > blameBlobLimit {
			continue
		}
		if err := b.load(item); err != nil {
			return err
		}
		text, err := b.read(entry.Hash)
		if err != nil {
			return err
		}
		passed, kept := split(remaining, diff.Matches(text, item.text))
		if len(passed) > 0 {
			b.pass(&blameItem{commit: parent, blob: entry.Hash, text: text, loaded: true, needs: passed, via: via})
		}
		remaining = kept
	}
	b.credit(item.commit, item.via, remaining, cut)
	return nil
}

// split maps the needs that fall in matches to the matched rows of the
// other side, keeping the rest. Both are sorted by row, so the mapped
// needs stay sorted.
func split(needs []blameNeed, matches []diff.Match) (passed, kept []blameNeed) {
	m := 0
	for _, need := range needs {
		for m < len(matches) && matches[m].New+matches[m].Lines <= need.line {
			m++
		}
		if m < len(matches) && matches[m].New <= need.line {
			passed = append(passed, blameNeed{line: matches[m].Old + need.line - matches[m].New, result: need.result})
			continue
		}
		kept = append(kept, need)
	}
	return passed, kept
}

// pass queues lines for a parent, joining the parent's queued item; the
// first via to reach a commit stays.
func (b *blamer) pass(item *blameItem) {
	queued, ok := b.queued[item.commit.Hash]
	if !ok {
		b.push(item)
		return
	}
	queued.needs = mergeNeeds(queued.needs, item.needs)
	if !queued.loaded && item.loaded {
		queued.text, queued.loaded = item.text, true
	}
}

func (b *blamer) push(item *blameItem) {
	item.order = b.pushed
	b.pushed++
	b.queued[item.commit.Hash] = item
	heap.Push(&b.queue, item)
}

// mergeNeeds merges two row-sorted need lists.
func mergeNeeds(a, c []blameNeed) []blameNeed {
	result := make([]blameNeed, 0, len(a)+len(c))
	for len(a) > 0 && len(c) > 0 {
		if c[0].line < a[0].line {
			result = append(result, c[0])
			c = c[1:]
		} else {
			result = append(result, a[0])
			a = a[1:]
		}
	}
	return append(append(result, a...), c...)
}

// credit attributes needs to commit, reached through via.
func (b *blamer) credit(commit *object.Commit, via plumbing.Hash, needs []blameNeed, boundary bool) {
	if len(needs) == 0 {
		return
	}
	index, ok := b.credited[commit.Hash]
	if !ok {
		index = len(b.result.Commits)
		b.credited[commit.Hash] = index
		b.result.Commits = append(b.result.Commits, BlameCommit{Commit: b.w.summary(commit)})
		b.vias = append(b.vias, via)
	}
	for _, need := range needs {
		b.result.Lines[need.result] = BlameLine{Commit: index, Line: need.line + 1, Boundary: boundary}
	}
}

// subjects fills in each credited commit's via merge.
func (b *blamer) subjects() error {
	read := map[plumbing.Hash]string{}
	for i, via := range b.vias {
		if via.IsZero() {
			continue
		}
		subject, ok := read[via]
		if !ok {
			commit, err := b.w.load(via)
			if err != nil {
				return err
			}
			subject = b.w.summary(commit).Subject
			read[via] = subject
		}
		b.result.Commits[i].Via, b.result.Commits[i].ViaSubject = via.String(), subject
	}
	return nil
}

// load reads an item's version unless it is loaded.
func (b *blamer) load(item *blameItem) error {
	if item.loaded {
		return nil
	}
	text, err := b.read(item.blob)
	if err != nil {
		return err
	}
	item.text, item.loaded = text, true
	return nil
}

// read reads a blob of at most blameBlobLimit bytes.
func (b *blamer) read(hash plumbing.Hash) ([]byte, error) {
	obj, err := b.w.repo.storage.EncodedObject(plumbing.BlobObject, hash)
	if err != nil {
		return nil, fmt.Errorf("read blob %s: %w", hash, err)
	}
	reader, err := obj.Reader()
	if err != nil {
		return nil, fmt.Errorf("read blob %s: %w", hash, err)
	}
	defer func() { _ = reader.Close() }()
	text, err := io.ReadAll(io.LimitReader(reader, blameBlobLimit))
	if err != nil {
		return nil, fmt.Errorf("read blob %s: %w", hash, err)
	}
	return text, nil
}

// blameQueue pops the newest committer date first, then the earliest
// queued.
type blameQueue struct{ items []*blameItem }

func (q *blameQueue) Len() int { return len(q.items) }

func (q *blameQueue) Less(a, c int) bool {
	ta, tc := q.items[a].commit.Committer.When, q.items[c].commit.Committer.When
	if !ta.Equal(tc) {
		return ta.After(tc)
	}
	return q.items[a].order < q.items[c].order
}

func (q *blameQueue) Swap(a, c int) { q.items[a], q.items[c] = q.items[c], q.items[a] }

func (q *blameQueue) Push(value any) {
	if item, ok := value.(*blameItem); ok {
		q.items = append(q.items, item)
	}
}

func (q *blameQueue) Pop() any {
	last := len(q.items) - 1
	item := q.items[last]
	q.items = q.items[:last]
	return item
}
