package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/flexdinesh/zero/internal/diff"
	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/internal/files"
	"github.com/flexdinesh/zero/internal/git"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
)

// Blame messages.
const (
	BlameBinaryMessage   = "Blame is unavailable for binary files."
	BlameTooLargeMessage = "Blame is unavailable for files over 4 MiB."
	fileUnavailable      = "That file is unavailable."
	blameFailure         = "Couldn't blame the file: "
)

const (
	// blameCacheSize bounds the commit blames kept between requests.
	blameCacheSize = 8
	// blameBodyLimit caps a blamed commit's body, in bytes.
	blameBodyLimit = 4 << 10
)

// Blame credits each line of a file to the commit that last changed it
// (decision 0139): with At, the file's version at that commit; else the
// working tree's file, whose lines that differ from HEAD's version are
// uncommitted. A file HEAD lacks, or an unborn HEAD, is all uncommitted.
// Binary files and files over document.PreviewLimit are refused with
// CodeBlameUnavailable. A folder project's working tree has no blame.
func (s *SourceControl) Blame(ctx context.Context, request contract.BlameRequest) (contract.BlameResponse, error) {
	project, err := s.project(request.Project)
	if err != nil {
		return contract.BlameResponse{}, err
	}
	if request.Path == "" {
		return contract.BlameResponse{}, fail(contract.KindInvalid, NoFileMessage)
	}
	if !git.ValidPath(request.Path) {
		return contract.BlameResponse{}, fail(contract.KindInvalid, "Path must be a repository-relative path.")
	}
	var at git.Hash
	if request.At != "" {
		hash, ok := git.ParseHash(request.At)
		if !ok {
			return contract.BlameResponse{}, fail(contract.KindInvalid, InvalidCommitMessage)
		}
		at = hash
	}
	response := contract.BlameResponse{Path: request.Path, Ranges: []contract.BlameRange{}, Commits: []contract.BlameCommitInfo{}}
	repo, err := git.Open(project.Root)
	if errors.Is(err, git.ErrNotRepository) {
		if request.At != "" {
			return contract.BlameResponse{}, fail(contract.KindNotFound, CommitUnavailableMessage)
		}
		return response, nil
	}
	if err != nil {
		return contract.BlameResponse{}, fail(contract.KindInternal, blameFailure+err.Error())
	}
	defer func() { _ = repo.Close() }()
	response.Repository = true

	ctx, cancel := context.WithTimeout(ctx, statusTimeout)
	defer cancel()
	fileType := s.config.Types.Lookup(request.Path).Type()
	origin := githubRepository(projects.OriginURL(project.Root))
	if request.At != "" {
		blob, err := repo.CommitBlob(at, request.Path)
		if errors.Is(err, git.ErrUnavailable) {
			return contract.BlameResponse{}, fail(contract.KindNotFound, CommitFileUnavailableMessage)
		}
		if err != nil {
			return contract.BlameResponse{}, fail(contract.KindInternal, blameFailure+err.Error())
		}
		text, err := readBlameBlob(blob, fileType)
		if err != nil {
			return contract.BlameResponse{}, err
		}
		blamed, err := s.commitBlame(ctx, repo, project.Root, at, request.Path, text)
		if err != nil {
			return contract.BlameResponse{}, err
		}
		response.Commit = at.String()
		return blamed.respond(response, origin), nil
	}

	text, err := s.readBlameWorktree(project.Root, request.Path, fileType)
	if err != nil {
		return contract.BlameResponse{}, err
	}
	head, err := repo.Head()
	if err != nil {
		return contract.BlameResponse{}, fail(contract.KindInternal, blameFailure+err.Error())
	}
	response.Commit = hashString(head)
	uncommitted := &blamed{lineCount: diff.Rows(text)}
	uncommitted.ranges = compactRanges(make([]lineCredit, uncommitted.lineCount))
	blob, err := repo.HeadBlob(request.Path)
	if errors.Is(err, git.ErrUnavailable) {
		return uncommitted.respond(response, origin), nil
	}
	if err != nil {
		return contract.BlameResponse{}, fail(contract.KindInternal, blameFailure+err.Error())
	}
	headText, err := readBlameBlob(blob, fileType)
	var refused *Error
	if errors.As(err, &refused) && refused.Code == contract.CodeBlameUnavailable {
		// HEAD's version shares no lines a blame can read.
		return uncommitted.respond(response, origin), nil
	}
	if err != nil {
		return contract.BlameResponse{}, err
	}
	blamed, err := s.commitBlame(ctx, repo, project.Root, blob.Commit, request.Path, headText)
	if err != nil {
		return contract.BlameResponse{}, err
	}
	if blob.Hash() != git.BlobHash(text) {
		blamed = blamed.onto(headText, text)
	}
	return blamed.respond(response, origin), nil
}

// commitBlame is the blame of path's version text at commit, from the cache
// when it holds it.
func (s *SourceControl) commitBlame(ctx context.Context, repo *git.Repository, root string, commit git.Hash, path string, text []byte) (*blamed, error) {
	common, _ := projects.CommonDir(root)
	key := blameKey{common: common, commit: commit.String(), path: path}
	if cached, ok := s.blames.get(key); ok {
		return cached, nil
	}
	result, err := repo.Blame(ctx, commit, path, text)
	if err != nil {
		if ctx.Err() != nil {
			return nil, fail(contract.KindUnavailable, "Blame took too long.")
		}
		if errors.Is(err, git.ErrUnavailable) {
			return nil, fail(contract.KindNotFound, CommitFileUnavailableMessage)
		}
		return nil, fail(contract.KindInternal, blameFailure+err.Error())
	}
	blamed := newBlamed(result)
	s.blames.put(key, blamed)
	return blamed, nil
}

// readBlameBlob reads a committed version a blame can read.
func readBlameBlob(blob git.Blob, fileType document.Type) ([]byte, error) {
	if refused := blameRefusal(fileType, blob.Size); refused != nil {
		return nil, refused
	}
	reader, err := blob.Open()
	if err != nil {
		return nil, fail(contract.KindInternal, blameFailure+err.Error())
	}
	defer func() { _ = reader.Close() }()
	return readBlameText(reader)
}

// readBlameWorktree reads the root-confined working-tree file a blame can
// read.
func (s *SourceControl) readBlameWorktree(root, path string, fileType document.Type) ([]byte, error) {
	resolved, err := files.ResolveFile(root, path)
	if err != nil {
		return nil, fail(contract.KindNotFound, fileUnavailable)
	}
	file, err := s.config.OpenFile(resolved)
	if err != nil {
		return nil, fail(contract.KindNotFound, fileUnavailable)
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		return nil, fail(contract.KindInternal, blameFailure+err.Error())
	}
	if refused := blameRefusal(fileType, info.Size()); refused != nil {
		return nil, refused
	}
	return readBlameText(file)
}

// blameRefusal refuses a file a blame cannot read: a type without a text
// source, or one over document.PreviewLimit.
func blameRefusal(fileType document.Type, size int64) *Error {
	switch {
	case !fileType.HasTextSource():
		return binaryRefusal()
	case size > document.PreviewLimit:
		return &Error{Kind: contract.KindTooLarge, Code: contract.CodeBlameUnavailable, Message: BlameTooLargeMessage}
	}
	return nil
}

// readBlameText reads text up to document.PreviewLimit, refusing binary
// content.
func readBlameText(reader io.Reader) ([]byte, error) {
	text, binary, err := document.ReadText(reader, document.PreviewLimit)
	if err != nil {
		return nil, fail(contract.KindInternal, blameFailure+err.Error())
	}
	if binary {
		return nil, binaryRefusal()
	}
	return text, nil
}

func binaryRefusal() *Error {
	return &Error{Kind: contract.KindUnprocessable, Code: contract.CodeBlameUnavailable, Message: BlameBinaryMessage}
}

// lineCredit is one line's attribution: commit indexes a blame's commits,
// -1 for an uncommitted line, whose line is 0.
type lineCredit struct {
	commit int
	line   int
	kind   contract.BlameKind
}

// blamed is a blame in contract form: ranges, and commits in order of first
// appearance without their pull requests, which depend on the origin
// remote, beside each commit's via merge subject.
type blamed struct {
	lineCount   int
	ranges      []contract.BlameRange
	commits     []contract.BlameCommitInfo
	viaSubjects []string
	truncated   bool
}

func newBlamed(result git.Blame) *blamed {
	credits := make([]lineCredit, len(result.Lines))
	for i, line := range result.Lines {
		kind := contract.BlameCommit
		if line.Boundary {
			kind = contract.BlameBoundary
		}
		credits[i] = lineCredit{commit: line.Commit, line: line.Line, kind: kind}
	}
	commits := make([]contract.BlameCommitInfo, len(result.Commits))
	vias := make([]string, len(result.Commits))
	for i, commit := range result.Commits {
		commits[i] = contract.BlameCommitInfo{
			Hash:       commit.Hash,
			Subject:    commit.Subject,
			Body:       capBody(commit.Body),
			Author:     contract.Author{Name: commit.Author.Name, Email: commit.Author.Email},
			AuthorTime: commit.AuthorTime.Format(authorTimeLayout),
		}
		vias[i] = commit.ViaSubject
	}
	return assemble(credits, commits, vias, result.Truncated)
}

// assemble numbers the commits credits use in order of first appearance
// and compacts the credits into ranges.
func assemble(credits []lineCredit, commits []contract.BlameCommitInfo, vias []string, truncated bool) *blamed {
	result := &blamed{lineCount: len(credits), commits: []contract.BlameCommitInfo{}, truncated: truncated}
	numbers := make(map[int]int, len(commits))
	for i, credit := range credits {
		if credit.kind == contract.BlameUncommitted {
			continue
		}
		number, ok := numbers[credit.commit]
		if !ok {
			number = len(result.commits)
			numbers[credit.commit] = number
			result.commits = append(result.commits, commits[credit.commit])
			result.viaSubjects = append(result.viaSubjects, vias[credit.commit])
		}
		credits[i].commit = number
	}
	result.ranges = compactRanges(credits)
	return result
}

// compactRanges joins consecutive lines of one kind and commit whose
// original lines are consecutive. The zero lineCredit is uncommitted.
func compactRanges(credits []lineCredit) []contract.BlameRange {
	ranges := []contract.BlameRange{}
	for i, credit := range credits {
		if credit.kind == "" || credit.kind == contract.BlameUncommitted {
			credit = lineCredit{commit: -1, kind: contract.BlameUncommitted}
		}
		if last := len(ranges) - 1; last >= 0 {
			previous := &ranges[last]
			if previous.Kind == credit.kind && previous.Commit == credit.commit &&
				(credit.kind == contract.BlameUncommitted || previous.OriginalLine+previous.Count == credit.line) {
				previous.Count++
				continue
			}
		}
		ranges = append(ranges, contract.BlameRange{Start: i + 1, Count: 1, Kind: credit.kind, Commit: credit.commit, OriginalLine: credit.line})
	}
	return ranges
}

// credits expands the ranges into one credit per line.
func (b *blamed) credits() []lineCredit {
	credits := make([]lineCredit, 0, b.lineCount)
	for _, r := range b.ranges {
		for i := range r.Count {
			credit := lineCredit{commit: r.Commit, kind: r.Kind}
			if r.Kind != contract.BlameUncommitted {
				credit.line = r.OriginalLine + i
			}
			credits = append(credits, credit)
		}
	}
	return credits
}

// onto maps a blame of committed onto text: lines diff.Matches pairs keep
// their credit, the rest are uncommitted.
func (b *blamed) onto(committed, text []byte) *blamed {
	from := b.credits()
	credits := make([]lineCredit, diff.Rows(text))
	for _, match := range diff.Matches(committed, text) {
		copy(credits[match.New:match.New+match.Lines], from[match.Old:match.Old+match.Lines])
	}
	for i := range credits {
		if credits[i].kind == "" {
			credits[i] = lineCredit{commit: -1, kind: contract.BlameUncommitted}
		}
	}
	return assemble(credits, b.commits, b.viaSubjects, b.truncated)
}

// respond fills response with the blame, finding each commit's pull request
// on the GitHub repository origin names, when it names one.
func (b *blamed) respond(response contract.BlameResponse, origin string) contract.BlameResponse {
	response.LineCount = b.lineCount
	response.Ranges = slices.Clone(b.ranges)
	response.Truncated = b.truncated
	response.Commits = make([]contract.BlameCommitInfo, len(b.commits))
	for i, commit := range b.commits {
		if origin != "" {
			commit.PullRequest = pullRequest(origin, commit.Subject, b.viaSubjects[i])
		}
		response.Commits[i] = commit
	}
	return response
}

// capBody cuts a body to blameBodyLimit bytes on a character boundary.
func capBody(body string) string {
	if len(body) <= blameBodyLimit {
		return body
	}
	cut := blameBodyLimit
	for cut > 0 && !utf8.RuneStart(body[cut]) {
		cut--
	}
	return body[:cut]
}

var (
	squashSubject = regexp.MustCompile(`\(#([0-9]+)\)\s*$`)
	mergeSubject  = regexp.MustCompile(`^Merge pull request #([0-9]+) from `)
)

// pullRequest finds a commit's pull request on the GitHub repository
// "https://github.com/<owner>/<repo>": its subject's squash suffix "(#N)"
// or merge subject "Merge pull request #N from ...", else its via merge's.
func pullRequest(repository, subject, viaSubject string) *contract.PullRequest {
	for _, text := range []string{subject, viaSubject} {
		for _, pattern := range []*regexp.Regexp{squashSubject, mergeSubject} {
			match := pattern.FindStringSubmatch(text)
			if match == nil {
				continue
			}
			number, err := strconv.Atoi(match[1])
			if err != nil || number <= 0 {
				continue
			}
			return &contract.PullRequest{Number: number, URL: fmt.Sprintf("%s/pull/%d", repository, number)}
		}
	}
	return nil
}

// githubRepository is the web address of the github.com repository an
// origin URL names ("git@github.com:owner/repo.git",
// "https://github.com/owner/repo", or "ssh://git@github.com/owner/repo"),
// or empty for any other remote.
func githubRepository(remote string) string {
	rest := ""
	lower := strings.ToLower(remote)
	for _, prefix := range []string{"git@github.com:", "https://github.com/", "ssh://git@github.com/"} {
		if strings.HasPrefix(lower, prefix) {
			rest = remote[len(prefix):]
			break
		}
	}
	rest = strings.TrimSuffix(strings.TrimSuffix(rest, "/"), ".git")
	owner, repo, ok := strings.Cut(rest, "/")
	if !ok || !githubName(owner) || !githubName(repo) {
		return ""
	}
	return "https://github.com/" + owner + "/" + repo
}

// githubName reports whether a name can be a GitHub owner or repository.
func githubName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	for _, c := range name {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' && c != '.' {
			return false
		}
	}
	return true
}

type blameKey struct{ common, commit, path string }

// blameCache keeps the most recently used commit blames; a nil cache keeps
// none. It is safe for concurrent use.
type blameCache struct {
	mu      sync.Mutex
	entries []blameEntry
}

type blameEntry struct {
	key    blameKey
	blamed *blamed
}

func newBlameCache() *blameCache { return &blameCache{} }

func (c *blameCache) get(key blameKey) (*blamed, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, entry := range c.entries {
		if entry.key == key {
			copy(c.entries[1:i+1], c.entries[:i])
			c.entries[0] = entry
			return entry.blamed, true
		}
	}
	return nil, false
}

func (c *blameCache) put(key blameKey, value *blamed) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, entry := range c.entries {
		if entry.key == key {
			c.entries = append(c.entries[:i], c.entries[i+1:]...)
			break
		}
	}
	if len(c.entries) >= blameCacheSize {
		c.entries = c.entries[:blameCacheSize-1]
	}
	c.entries = append([]blameEntry{{key: key, blamed: value}}, c.entries...)
}
