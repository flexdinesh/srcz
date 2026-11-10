package feedback

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Anchoring limits (decision 0120).
const (
	// MaxAnchorLines bounds the anchored text kept: the first lines of a
	// longer range.
	MaxAnchorLines = 20
	// MaxAnchorBytes bounds the anchored text kept, and each context line.
	MaxAnchorBytes = 2 << 10
	// ContextLines is how many lines before and after the text are kept.
	ContextLines = 3
	// MaxContentBytes is the largest side anchored or resolved by lines.
	MaxContentBytes = 8 << 20
	// sniffLength is the prefix searched for a NUL, as decision 0004 does.
	sniffLength = 8000
)

// Anchor states say where a thread's text is now.
const (
	StateAnchored = "anchored"
	StateMoved    = "moved"
	StateOutdated = "outdated"
)

// Side is one file side as a caller read it: missing, present but over
// MaxContentBytes (Content not read), or present with Content.
type Side struct {
	Exists   bool
	TooLarge bool
	Content  []byte
}

// Location is an anchor resolved against a side: its state and, unless
// file-level or outdated, its lines now.
type Location struct {
	State string
	Lines *Lines
}

// Snapshot is what a new anchor records from its side.
type Snapshot struct {
	Text   []string
	Before []string
	After  []string
	Blob   string
}

// Capture errors reject a line anchor.
var (
	// ErrTooLarge: the side is over MaxContentBytes.
	ErrTooLarge = errors.New("the file is over 8 MiB")
	// ErrBinary: the side has a NUL in its first 8000 bytes.
	ErrBinary = errors.New("the file is binary")
)

// PastEndError rejects lines past a side's last line.
type PastEndError struct {
	End, Count int
}

func (e *PastEndError) Error() string {
	return fmt.Sprintf("end %d is past the file's last line, %d", e.End, e.Count)
}

// BlobHash returns the git blob hash content is stored under: the SHA-1 of
// "blob <length>\x00" and the content.
func BlobHash(content []byte) string {
	hash := sha1.New()
	_, _ = hash.Write([]byte("blob " + strconv.Itoa(len(content)) + "\x00"))
	_, _ = hash.Write(content)
	return hex.EncodeToString(hash.Sum(nil))
}

// SplitLines splits content into lines without their line endings; a final
// line ending starts no line.
func SplitLines(content []byte) []string {
	if len(content) == 0 {
		return nil
	}
	text := strings.TrimSuffix(string(content), "\n")
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSuffix(line, "\r")
	}
	return lines
}

func isBinary(content []byte) bool {
	return bytes.IndexByte(content[:min(len(content), sniffLength)], 0) >= 0
}

// Capture records an anchor's text, context, and blob from side. A
// file-level anchor (nil lines) records the blob when the content was read;
// a line anchor needs a text side within MaxContentBytes and lines within
// it. Text keeps the first MaxAnchorLines lines within MaxAnchorBytes; a
// first line longer than that is cut, as is each context line.
func Capture(side Side, lines *Lines) (Snapshot, error) {
	if lines == nil {
		if !side.Exists || side.TooLarge {
			return Snapshot{}, nil
		}
		return Snapshot{Blob: BlobHash(side.Content)}, nil
	}
	if side.TooLarge || len(side.Content) > MaxContentBytes {
		return Snapshot{}, ErrTooLarge
	}
	if isBinary(side.Content) {
		return Snapshot{}, ErrBinary
	}
	all := SplitLines(side.Content)
	if lines[1] > len(all) {
		return Snapshot{}, &PastEndError{End: lines[1], Count: len(all)}
	}
	start, end := lines[0]-1, lines[1]
	snapshot := Snapshot{Blob: BlobHash(side.Content)}
	size := 0
	for _, line := range all[start:min(end, start+MaxAnchorLines)] {
		if size+len(line) > MaxAnchorBytes {
			if len(snapshot.Text) == 0 {
				snapshot.Text = append(snapshot.Text, cut(line))
			}
			break
		}
		size += len(line)
		snapshot.Text = append(snapshot.Text, line)
	}
	for _, line := range all[max(start-ContextLines, 0):start] {
		snapshot.Before = append(snapshot.Before, cut(line))
	}
	for _, line := range all[end:min(end+ContextLines, len(all))] {
		snapshot.After = append(snapshot.After, cut(line))
	}
	return snapshot, nil
}

// cut shortens a line to MaxAnchorBytes on a character boundary.
func cut(line string) string {
	if len(line) <= MaxAnchorBytes {
		return line
	}
	end := MaxAnchorBytes
	for end > 0 && !utf8.RuneStart(line[end]) {
		end--
	}
	return line[:end]
}

// sameLine compares a side's line with a recorded one after trimming
// trailing whitespace. A recorded line that was cut matches as a prefix.
func sameLine(line, recorded string) bool {
	trimmed := strings.TrimRight(recorded, " \t\r")
	if strings.TrimRight(line, " \t\r") == trimmed {
		return true
	}
	return len(recorded) > MaxAnchorBytes-utf8.UTFMax && len(line) > len(recorded) && strings.HasPrefix(line, trimmed)
}

// Resolve finds an anchor in side's current content:
//  1. a missing side is outdated; a file-level anchor is otherwise anchored;
//  2. a binary side or one over MaxContentBytes is outdated;
//  3. the same blob is anchored at the same lines;
//  4. otherwise the text is searched, line by line after trimming trailing
//     whitespace: no match is outdated; one is moved (anchored when at the
//     same lines); among several, the most matching context lines win, then
//     the nearest to the original start, then the earlier.
//
// A moved range keeps the original's length, cut at the file's end.
func Resolve(anchor Anchor, side Side) Location {
	outdated := Location{State: StateOutdated}
	if !side.Exists {
		return outdated
	}
	if anchor.Lines == nil {
		return Location{State: StateAnchored}
	}
	if side.TooLarge || len(side.Content) > MaxContentBytes || isBinary(side.Content) {
		return outdated
	}
	original := *anchor.Lines
	if anchor.Blob != "" && BlobHash(side.Content) == anchor.Blob {
		return Location{State: StateAnchored, Lines: &original}
	}
	if len(anchor.Text) == 0 {
		return outdated
	}
	lines := SplitLines(side.Content)
	span := original[1] - original[0] + 1
	best, bestScore, bestDistance := -1, -1, 0
	for start := 0; start+len(anchor.Text) <= len(lines); start++ {
		if !matchesAt(lines, start, anchor.Text) {
			continue
		}
		score := contextScore(lines, start, span, anchor.Before, anchor.After)
		distance := abs(start + 1 - original[0])
		if score > bestScore || score == bestScore && distance < bestDistance {
			best, bestScore, bestDistance = start, score, distance
		}
	}
	if best < 0 {
		return outdated
	}
	found := Lines{best + 1, min(best+span, len(lines))}
	if found == original {
		return Location{State: StateAnchored, Lines: &found}
	}
	return Location{State: StateMoved, Lines: &found}
}

func matchesAt(lines []string, start int, text []string) bool {
	for i, recorded := range text {
		if !sameLine(lines[start+i], recorded) {
			return false
		}
	}
	return true
}

// contextScore counts the recorded context lines that match around a
// candidate starting at start and spanning span lines.
func contextScore(lines []string, start, span int, before, after []string) int {
	score := 0
	for i, recorded := range before {
		index := start - len(before) + i
		if index >= 0 && sameLine(lines[index], recorded) {
			score++
		}
	}
	for i, recorded := range after {
		index := start + span + i
		if index < len(lines) && sameLine(lines[index], recorded) {
			score++
		}
	}
	return score
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
