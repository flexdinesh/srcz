package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/internal/feedback"
	"github.com/flexdinesh/zero/internal/files"
	"github.com/flexdinesh/zero/internal/git"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
)

// Feedback (decision 0120) keeps review feedback threads, one feedback per
// repository and branch: it derives the key (the repository's common git
// directory, else the folder, and the branch), reads file sides to anchor
// new threads and re-anchor stored ones, renders messages as walkthrough
// narration is rendered, and announces every change to the followed
// projects of the same repository and to control streams.
type Feedback struct {
	*state
	service *feedback.Service
	notices noticeHub[FeedbackNotice]
}

// FeedbackNotice is a feedback announcement and the repository key whose
// followed projects carry it.
type FeedbackNotice struct {
	Repository string
	Event      contract.FeedbackEvent
}

// MaxFeedbackBytes bounds one encoded draft.
const MaxFeedbackBytes = feedback.MaxRequestBytes

// FeedbackRejected is a rejected draft: an invalidFeedback *Error (Unwrap)
// that keeps every problem for clients that list them, as the CLI does.
type FeedbackRejected struct {
	Problems feedback.Problems
}

func (r *FeedbackRejected) Error() string { return r.Problems.Error() }

// Unwrap is the transport failure: invalid, code invalidFeedback.
func (r *FeedbackRejected) Unwrap() error {
	return &Error{Kind: contract.KindInvalid, Code: contract.CodeInvalidFeedback, Message: r.Problems.Error()}
}

// rejected turns a feedback.Problems error into a *FeedbackRejected.
func rejected(err error) error {
	var problems feedback.Problems
	if errors.As(err, &problems) {
		return &FeedbackRejected{Problems: problems}
	}
	return err
}

func rejectedAt(field, format string, args ...any) error {
	return &FeedbackRejected{Problems: feedback.Problems{{Field: field, Message: fmt.Sprintf(format, args...)}}}
}

// DecodeFeedbackThreadDraft reads one strict JSON thread draft: unknown
// fields and trailing data fail. Errors wrap the reader's, so a transport
// can tell a body over its limit.
func DecodeFeedbackThreadDraft(r io.Reader) (contract.FeedbackThreadDraft, error) {
	var draft contract.FeedbackThreadDraft
	if err := feedback.Decode(r, &draft); err != nil {
		return contract.FeedbackThreadDraft{}, err
	}
	return draft, nil
}

// DecodeFeedbackMessageDraft reads one strict JSON message draft, as
// DecodeFeedbackThreadDraft does.
func DecodeFeedbackMessageDraft(r io.Reader) (contract.FeedbackMessageDraft, error) {
	var draft contract.FeedbackMessageDraft
	if err := feedback.Decode(r, &draft); err != nil {
		return contract.FeedbackMessageDraft{}, err
	}
	return draft, nil
}

// Get returns a branch's feedback with every thread's location resolved
// against request.Compare, or else the working tree (new side) and the
// thread's own compare (old side). Without an ID it reads the feedback of
// the compare's head branch, or HEAD's; a branch without feedback answers
// an empty one with ID "". An unknown ID is feedbackUnavailable.
func (f *Feedback) Get(ctx context.Context, request contract.FeedbackRequest) (contract.Feedback, error) {
	project, err := f.resolve(request.Project)
	if err != nil {
		return contract.Feedback{}, err
	}
	var compare *feedback.Compare
	if request.Compare != nil {
		checked, err := feedback.CheckCompare(compareModel(*request.Compare))
		if err != nil {
			return contract.Feedback{}, rejected(err)
		}
		compare = &checked
	}
	repository := FeedbackRepository(project.Root)
	var stored feedback.Feedback
	if request.ID != "" {
		stored, err = f.service.Get(repository, request.ID)
	} else {
		branch := requestBranch(project.Root, compare)
		stored, err = f.service.Find(repository, branch)
		if errors.Is(err, feedback.ErrNotFound) {
			return contract.Feedback{Project: project.Root, Branch: branch, Threads: []contract.FeedbackThread{}}, nil
		}
	}
	if err != nil {
		return contract.Feedback{}, f.readFailure(request.ID, err)
	}
	ctx, cancel := context.WithTimeout(ctx, statusTimeout)
	defer cancel()
	sides := f.sides(ctx, project.Root)
	defer sides.close()
	if compare != nil {
		if _, err := sides.view(*compare); err != nil {
			return contract.Feedback{}, compareFailure(err)
		}
	}
	threads := make([]contract.FeedbackThread, 0, len(stored.Threads))
	for _, thread := range stored.Threads {
		location, err := sides.locate(thread.Anchor, compare)
		if err != nil {
			return contract.Feedback{}, fail(contract.KindInternal, "Couldn't read the feedback's files: "+err.Error())
		}
		threads = append(threads, threadContract(f.config.Types, project.Root, thread, location))
	}
	return contract.Feedback{ID: stored.ID, Project: project.Root, Branch: stored.Branch, Threads: threads, CreatedAt: formatTime(stored.CreatedAt), UpdatedAt: formatTime(stored.UpdatedAt)}, nil
}

// List returns a project's repository's feedback, one per branch, most
// recently updated first.
func (f *Feedback) List(request contract.FeedbackListRequest) ([]contract.FeedbackSummary, error) {
	project, err := f.resolve(request.Project)
	if err != nil {
		return nil, err
	}
	summaries, err := f.service.List(FeedbackRepository(project.Root))
	if err != nil {
		return nil, fail(contract.KindInternal, "Couldn't list feedback: "+err.Error())
	}
	result := make([]contract.FeedbackSummary, len(summaries))
	for i, summary := range summaries {
		result[i] = contract.FeedbackSummary{ID: summary.ID, Branch: summary.Branch, Threads: summary.Threads, Open: summary.Open, AwaitingAgent: summary.AwaitingAgent, AwaitingUser: summary.AwaitingUser, UpdatedAt: formatTime(summary.UpdatedAt)}
	}
	return result, nil
}

// CreateThread starts a thread: Author defaults to user. The path must be a
// file zero shows (Source) or one on Side of Compare, and lines must fall
// within a text side of at most 8 MiB; the anchor records the side's text,
// context, and blob. The feedback is ID's, or else the compare's head
// branch's, or HEAD's, created when missing. The thread's location resolves
// against Compare.
func (f *Feedback) CreateThread(ctx context.Context, draft contract.FeedbackThreadDraft) (contract.FeedbackThread, error) {
	if draft.Author == "" {
		draft.Author = contract.FeedbackAuthorUser
	}
	model, err := threadDraftModel(draft).Normalize()
	if err != nil {
		return contract.FeedbackThread{}, rejected(err)
	}
	project, err := f.resolve(model.Project)
	if err != nil {
		return contract.FeedbackThread{}, err
	}
	repository := FeedbackRepository(project.Root)
	branch := requestBranch(project.Root, model.Compare)
	if model.ID != "" {
		existing, err := f.service.Get(repository, model.ID)
		if err != nil {
			return contract.FeedbackThread{}, f.readFailure(model.ID, err)
		}
		branch = existing.Branch
	}

	ctx, cancel := context.WithTimeout(ctx, statusTimeout)
	defer cancel()
	sides := f.sides(ctx, project.Root)
	defer sides.close()
	anchor, err := sides.anchor(model, f.config.Depth)
	if err != nil {
		return contract.FeedbackThread{}, err
	}
	stored, thread, err := f.service.AddThread(feedback.Target{Repository: repository, Branch: branch, ID: model.ID, Project: project.Root}, feedback.NewThread{Anchor: anchor, Author: model.Author, Name: model.Name, Body: model.Body})
	if err != nil {
		return contract.FeedbackThread{}, f.writeFailure(model.ID, err)
	}
	location, err := sides.locate(thread.Anchor, model.Compare)
	if err != nil {
		return contract.FeedbackThread{}, fail(contract.KindInternal, "Couldn't read the thread's file: "+err.Error())
	}
	f.announce(repository, project.Root, stored, contract.FeedbackAuthor(model.Author))
	return threadContract(f.config.Types, project.Root, thread, location), nil
}

// PostMessage replies to a thread, changes its status, or both: Author
// defaults to user, and a user reply without a status reopens a closed
// thread. The thread's location resolves without a compare.
func (f *Feedback) PostMessage(ctx context.Context, draft contract.FeedbackMessageDraft) (contract.FeedbackThread, error) {
	if draft.Author == "" {
		draft.Author = contract.FeedbackAuthorUser
	}
	model, err := feedback.MessageDraft{Project: draft.Project, ID: draft.ID, Thread: draft.Thread, Body: draft.Body, Status: string(draft.Status), Author: string(draft.Author), Name: draft.Name}.Normalize()
	if err != nil {
		return contract.FeedbackThread{}, rejected(err)
	}
	project, err := f.resolve(model.Project)
	if err != nil {
		return contract.FeedbackThread{}, err
	}
	repository := FeedbackRepository(project.Root)
	stored, thread, err := f.service.AddMessage(repository, model.ID, project.Root, feedback.NewMessage{Thread: model.Thread, Author: model.Author, Name: model.Name, Body: model.Body, Status: model.Status})
	if err != nil {
		return contract.FeedbackThread{}, f.writeFailure(model.ID, err)
	}
	ctx, cancel := context.WithTimeout(ctx, statusTimeout)
	defer cancel()
	sides := f.sides(ctx, project.Root)
	defer sides.close()
	location, err := sides.locate(thread.Anchor, nil)
	if err != nil {
		return contract.FeedbackThread{}, fail(contract.KindInternal, "Couldn't read the thread's file: "+err.Error())
	}
	f.announce(repository, project.Root, stored, contract.FeedbackAuthor(model.Author))
	return threadContract(f.config.Types, project.Root, thread, location), nil
}

// DeleteThread removes one thread of a feedback; its number is not reused.
func (f *Feedback) DeleteThread(request contract.FeedbackDeleteRequest) error {
	if request.Thread < 1 {
		return rejectedAt("thread", "is required: a thread number from 1")
	}
	project, repository, err := f.target(request)
	if err != nil {
		return err
	}
	stored, err := f.service.DeleteThread(repository, request.ID, request.Thread)
	if err != nil {
		return f.writeFailure(request.ID, err)
	}
	f.announce(repository, project, stored, contract.FeedbackAuthorUser)
	return nil
}

// Delete removes a whole feedback.
func (f *Feedback) Delete(request contract.FeedbackDeleteRequest) error {
	project, repository, err := f.target(request)
	if err != nil {
		return err
	}
	stored, err := f.service.Get(repository, request.ID)
	if err == nil {
		err = f.service.Delete(repository, request.ID)
	}
	if err != nil {
		return f.writeFailure(request.ID, err)
	}
	stored.UpdatedAt = f.now()
	f.announce(repository, project, stored, contract.FeedbackAuthorUser)
	return nil
}

func (f *Feedback) target(request contract.FeedbackDeleteRequest) (string, string, error) {
	if request.ID == "" {
		return "", "", rejectedAt("id", "is required: a feedback ID such as fb-3k2q8m")
	}
	project, err := f.resolve(request.Project)
	if err != nil {
		return "", "", err
	}
	return project.Root, FeedbackRepository(project.Root), nil
}

// Announce tells every subscriber that project's feedback id changed
// elsewhere (the CLI writes the same store); author wrote the change. It
// fails with CodeProjectUnavailable when no served root resolves project
// and CodeFeedbackUnavailable when the store lacks the feedback.
func (f *Feedback) Announce(project, id string, author contract.FeedbackAuthor) (contract.FeedbackEvent, error) {
	resolved, err := f.resolve(project)
	if err != nil {
		return contract.FeedbackEvent{}, &Error{Kind: contract.KindNotFound, Code: contract.CodeProjectUnavailable, Message: ProjectUnavailableMessage}
	}
	if author != contract.FeedbackAuthorUser && author != contract.FeedbackAuthorAgent {
		return contract.FeedbackEvent{}, rejectedAt("author", `must be "user" or "agent"`)
	}
	repository := FeedbackRepository(resolved.Root)
	stored, err := f.service.Get(repository, id)
	if err != nil {
		return contract.FeedbackEvent{}, f.readFailure(id, err)
	}
	return f.announce(repository, resolved.Root, stored, author), nil
}

// Notices subscribes to feedback announcements. Each subscriber buffers 16
// and drops the oldest when full. The channel closes after cancel or
// CloseNotices.
func (f *Feedback) Notices() (notices <-chan FeedbackNotice, cancel func()) {
	return f.notices.subscribe()
}

// CloseNotices ends every notice subscription; later ones start closed.
func (f *Feedback) CloseNotices() { f.notices.close() }

func (f *Feedback) announce(repository, project string, stored feedback.Feedback, author contract.FeedbackAuthor) contract.FeedbackEvent {
	event := contract.FeedbackEvent{Project: project, ID: stored.ID, Branch: stored.Branch, Author: author, UpdatedAt: formatTime(stored.UpdatedAt)}
	f.notices.announce(FeedbackNotice{Repository: repository, Event: event})
	return event
}

func (f *Feedback) now() time.Time { return time.Now().UTC() }

func (f *Feedback) resolve(project string) (Workspace, error) {
	return ResolveProject(f.config.Roots.List(), project)
}

// readFailure maps a failed read of feedback id.
func (f *Feedback) readFailure(id string, err error) error {
	if errors.Is(err, feedback.ErrNotFound) {
		return unavailableFeedback(id)
	}
	return fail(contract.KindInternal, "Couldn't read feedback: "+err.Error())
}

// writeFailure maps a failed change of feedback id.
func (f *Feedback) writeFailure(id string, err error) error {
	switch {
	case errors.Is(err, feedback.ErrNotFound):
		return unavailableFeedback(id)
	case errors.Is(err, feedback.ErrFull):
		return &Error{Kind: contract.KindInvalid, Code: contract.CodeFeedbackFull, Message: err.Error()}
	}
	var problems feedback.Problems
	if errors.As(err, &problems) {
		return rejected(err)
	}
	return fail(contract.KindInternal, "Couldn't save feedback: "+err.Error())
}

func unavailableFeedback(id string) *Error {
	message := "No feedback for this branch."
	if id != "" {
		message = "no feedback " + id + " for this repository"
	}
	return &Error{Kind: contract.KindNotFound, Code: contract.CodeFeedbackUnavailable, Message: message}
}

// compareFailure maps a compare that cannot be read.
func compareFailure(err error) error {
	if failure := branchError(err); failure != nil {
		return failure
	}
	switch {
	case errors.Is(err, git.ErrUnavailable):
		return fail(contract.KindNotFound, CommitUnavailableMessage)
	case errors.Is(err, git.ErrRangeTooLarge):
		return fail(contract.KindInvalid, err.Error())
	}
	return fail(contract.KindInternal, historyFailure+err.Error())
}

// FeedbackRepository is the repository key of a project directory: its
// common git directory, shared by every worktree, or else the directory.
func FeedbackRepository(root string) string {
	if common, ok := projects.CommonDir(root); ok {
		return common
	}
	return root
}

// requestBranch is the branch a request without an ID names: a branch
// compare's head, or else HEAD's branch, "" when detached or not a checkout.
func requestBranch(root string, compare *feedback.Compare) string {
	if compare != nil && compare.Kind == feedback.CompareBranch && compare.Head != "" {
		return compare.Head
	}
	head, err := git.ReadHead(root)
	if err != nil {
		return ""
	}
	return head.Branch
}

func compareModel(compare contract.FeedbackCompare) feedback.Compare {
	return feedback.Compare{Kind: string(compare.Kind), Base: compare.Base, Head: compare.Head, Uncommitted: compare.Uncommitted, Commit: compare.Commit, From: compare.From, To: compare.To}
}

func compareContract(compare *feedback.Compare) *contract.FeedbackCompare {
	if compare == nil {
		return nil
	}
	return &contract.FeedbackCompare{Kind: contract.FeedbackCompareKind(compare.Kind), Base: compare.Base, Head: compare.Head, Uncommitted: compare.Uncommitted, Commit: compare.Commit, From: compare.From, To: compare.To}
}

func threadDraftModel(draft contract.FeedbackThreadDraft) feedback.ThreadDraft {
	model := feedback.ThreadDraft{Project: draft.Project, ID: draft.ID, Path: draft.Path, Side: string(draft.Side), Lines: draft.Lines, Body: draft.Body, Author: string(draft.Author), Name: draft.Name}
	if draft.Compare != nil {
		compare := compareModel(*draft.Compare)
		model.Compare = &compare
	}
	return model
}

func linesSlice(lines *feedback.Lines) []int {
	if lines == nil {
		return nil
	}
	return []int{lines[0], lines[1]}
}

// threadContract is a stored thread with its location, rendered messages,
// and its current path's highlight language; Markdown renders as walkthrough
// narration does, links resolving from the project root.
func threadContract(types *document.Registry, root string, thread feedback.Thread, location resolvedLocation) contract.FeedbackThread {
	context := document.Context{Project: root}
	messages := make([]contract.FeedbackMessage, len(thread.Messages))
	for i, message := range thread.Messages {
		rendered, err := document.RenderMarkdown([]byte(message.Body), context)
		if err != nil || message.Body == "" {
			rendered = ""
		}
		messages[i] = contract.FeedbackMessage{Number: message.Number, Author: contract.FeedbackAuthor(message.Author), Name: message.Name, Body: message.Body, BodyHTML: rendered, Status: contract.FeedbackStatus(message.Status), CreatedAt: formatTime(message.CreatedAt)}
	}
	anchor := thread.Anchor
	return contract.FeedbackThread{
		Number:   thread.Number,
		Status:   contract.FeedbackStatus(thread.Status),
		Awaiting: contract.FeedbackAwaiting(thread.Awaiting()),
		Anchor: contract.FeedbackAnchor{
			Path: anchor.Path, Side: contract.FeedbackSide(anchor.Side), Lines: linesSlice(anchor.Lines),
			Text: anchor.Text, Before: anchor.Before, After: anchor.After, Blob: anchor.Blob, Compare: compareContract(anchor.Compare),
			Language: highlightLanguage(types, location.Path),
		},
		Location:  contract.FeedbackLocation{State: contract.FeedbackAnchorState(location.State), Path: location.Path, Side: contract.FeedbackSide(anchor.Side), Lines: linesSlice(location.Lines)},
		Messages:  messages,
		CreatedAt: formatTime(thread.CreatedAt),
		UpdatedAt: formatTime(thread.UpdatedAt),
	}
}

// highlightLanguage is the registry's highlight language for a path, "" for
// plain text and images.
func highlightLanguage(types *document.Registry, path string) string {
	language := types.Lookup(path).Type().Language
	if language == "text" {
		return ""
	}
	return language
}

// resolvedLocation is an anchor resolved within a compare or the working
// tree: Path is the compare's path for a renamed file.
type resolvedLocation struct {
	feedback.Location
	Path string
}

// feedbackSides reads file sides for one request: the working tree,
// root-confined, and git sides of the compares it names, each listed at
// most once.
type feedbackSides struct {
	ctx      context.Context
	root     string
	openFile func(string) (io.ReadCloser, error)
	repo     *git.Repository
	opened   bool
	openErr  error
	views    map[feedback.Compare]*compareView
	index    *files.Index
}

// compareView is one compare's changes (for renames) and where its sides
// are read: old through git, new through git or, for working and
// uncommitted branch compares, the working tree.
type compareView struct {
	err      error
	changes  []git.Change
	old      func(name string) (git.Blob, error)
	new      func(name string) (git.Blob, error)
	worktree bool
}

func (f *Feedback) sides(ctx context.Context, root string) *feedbackSides {
	open := f.config.OpenFile
	return &feedbackSides{ctx: ctx, root: root, openFile: func(name string) (io.ReadCloser, error) { return open(name) }, views: map[feedback.Compare]*compareView{}}
}

func (s *feedbackSides) close() {
	if s.repo != nil {
		_ = s.repo.Close()
	}
}

// repository opens the project's repository once; a folder has none.
func (s *feedbackSides) repository() (*git.Repository, error) {
	if !s.opened {
		s.opened = true
		repo, err := git.Open(s.root)
		if err != nil && !errors.Is(err, git.ErrNotRepository) {
			s.openErr = err
		}
		s.repo = repo
	}
	return s.repo, s.openErr
}

// view lists a compare once. A folder's working compare reads the working
// tree and has no old side; its other compares have no sides.
func (s *feedbackSides) view(compare feedback.Compare) (*compareView, error) {
	if view, ok := s.views[compare]; ok {
		return view, view.err
	}
	view := &compareView{}
	s.views[compare] = view
	repo, err := s.repository()
	if err != nil {
		view.err = err
		return view, err
	}
	if repo == nil {
		view.worktree = compare.Kind == feedback.CompareWorking || compare.Kind == feedback.CompareBranch && compare.Uncommitted
		return view, nil
	}
	switch {
	case compare.Kind == feedback.CompareWorking:
		changes, err := repo.Status(s.ctx, git.StatusOptions{Limit: changesLimit})
		view.err = err
		view.changes, view.old, view.worktree = changes.Files, repo.HeadBlob, true
	case compare.Kind == feedback.CompareBranch && compare.Uncommitted:
		compared, changes, err := repo.BranchWorkingFiles(s.ctx, compare.Base, git.StatusOptions{Limit: changesLimit})
		view.err = err
		view.changes, view.old, view.worktree = changes.Files, commitBlob(repo, compared.Reference), true
	case compare.Kind == feedback.CompareBranch:
		compared, changes, err := repo.BranchFiles(s.ctx, compare.Base, compare.Head, commitFilesLimit)
		reference := compared.Head
		if compared.Ahead > 0 {
			reference = compared.MergeBase
		}
		view.err = err
		view.changes, view.old, view.new = changes.Files, commitBlob(repo, reference), commitBlob(repo, compared.Head)
	case compare.Kind == feedback.CompareCommit:
		hash, _ := git.ParseHash(compare.Commit)
		changes, err := repo.CommitFiles(s.ctx, hash, commitFilesLimit)
		view.err = err
		view.changes = changes.Files
		view.old = func(name string) (git.Blob, error) { return repo.ParentBlob(hash, name) }
		view.new = commitBlob(repo, hash)
	default:
		from, _ := git.ParseHash(compare.From)
		to, _ := git.ParseHash(compare.To)
		changes, err := repo.RangeFiles(s.ctx, from, to, commitFilesLimit)
		view.err = err
		view.changes = changes.Files
		view.old = func(name string) (git.Blob, error) { return repo.ParentBlob(from, name) }
		view.new = commitBlob(repo, to)
	}
	return view, view.err
}

// commitBlob reads files at commit; a zero commit (an empty tree) has none.
func commitBlob(repo *git.Repository, commit git.Hash) func(string) (git.Blob, error) {
	if commit.IsZero() {
		return nil
	}
	return func(name string) (git.Blob, error) { return repo.CommitBlob(commit, name) }
}

// paths maps an anchor path on side to the compare's file path, which
// follows a rename, and the path its content is read from on that side.
func (v *compareView) paths(name, side string) (shown, content string) {
	for _, change := range v.changes {
		if change.OldPath == "" {
			continue
		}
		switch {
		case change.OldPath == name && side == feedback.SideNew:
			return change.Path, change.Path
		case change.OldPath == name:
			return change.Path, name
		case change.Path == name && side == feedback.SideOld:
			return change.Path, change.OldPath
		}
	}
	return name, name
}

// read reads name on side of the view.
func (s *feedbackSides) read(view *compareView, name, side string) (feedback.Side, error) {
	if side == feedback.SideNew && view.worktree {
		return s.worktree(name)
	}
	read := view.new
	if side == feedback.SideOld {
		read = view.old
	}
	if read == nil {
		return feedback.Side{}, nil
	}
	blob, err := read(name)
	if errors.Is(err, git.ErrUnavailable) {
		return feedback.Side{}, nil
	}
	if err != nil {
		return feedback.Side{}, err
	}
	return s.content(blob.Size, blob.Open)
}

// worktree reads a working-tree file, root-confined and outside .git; a
// missing one is absent.
func (s *feedbackSides) worktree(name string) (feedback.Side, error) {
	if !git.ValidPath(name) {
		return feedback.Side{}, nil
	}
	resolved, err := files.ResolveFile(s.root, name)
	if err != nil {
		return feedback.Side{}, nil
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return feedback.Side{}, nil
	}
	return s.content(info.Size(), func() (io.ReadCloser, error) { return s.openFile(resolved) })
}

// content reads a side of size bytes, unless it is over the anchoring limit.
func (s *feedbackSides) content(size int64, open func() (io.ReadCloser, error)) (feedback.Side, error) {
	if size > feedback.MaxContentBytes {
		return feedback.Side{Exists: true, TooLarge: true}, nil
	}
	reader, err := open()
	if err != nil {
		return feedback.Side{}, err
	}
	defer func() { _ = reader.Close() }()
	content, err := io.ReadAll(io.LimitReader(reader, feedback.MaxContentBytes+1))
	if err != nil {
		return feedback.Side{}, err
	}
	if len(content) > feedback.MaxContentBytes {
		return feedback.Side{Exists: true, TooLarge: true}, nil
	}
	return feedback.Side{Exists: true, Content: content}, nil
}

// locate resolves an anchor against compare's sides, or else, new sides in
// the working tree and old sides in the anchor's own compare (outdated when
// that compare can't be read).
func (s *feedbackSides) locate(anchor feedback.Anchor, compare *feedback.Compare) (resolvedLocation, error) {
	outdated := resolvedLocation{Location: feedback.Location{State: feedback.StateOutdated}, Path: anchor.Path}
	var view *compareView
	switch {
	case compare != nil:
		v, err := s.view(*compare)
		if err != nil {
			return outdated, nil
		}
		view = v
	case anchor.Side == feedback.SideNew:
		view = &compareView{worktree: true}
	case anchor.Compare == nil:
		return outdated, nil
	default:
		v, err := s.view(*anchor.Compare)
		if err != nil {
			return outdated, nil
		}
		view = v
	}
	shown, content := view.paths(anchor.Path, anchor.Side)
	side, err := s.read(view, content, anchor.Side)
	if err != nil {
		return outdated, err
	}
	location := feedback.Resolve(anchor, side)
	return resolvedLocation{Location: location, Path: shown}, nil
}

// anchor checks a normalized draft's path and lines against its side and
// records the anchor: a Source thread's path must be a file zero shows
// (within depth); a compare thread's must be a file on its side.
func (s *feedbackSides) anchor(draft feedback.ThreadDraft, depth int) (feedback.Anchor, error) {
	lines := draft.LinesRange()
	var side feedback.Side
	content := draft.Path
	if draft.Compare == nil {
		if s.index == nil {
			index, err := files.Scan(s.root, depth, func(string) bool { return true })
			if err != nil {
				return feedback.Anchor{}, fail(contract.KindInternal, "Couldn't scan the project: "+err.Error())
			}
			s.index = index
		}
		if _, err := s.index.Resolve(draft.Path); err != nil {
			return feedback.Anchor{}, rejectedAt("path", "is not a file zero shows in the project (missing, excluded, or too deep)")
		}
		read, err := s.worktree(draft.Path)
		if err != nil {
			return feedback.Anchor{}, fail(contract.KindInternal, "Couldn't read the file: "+err.Error())
		}
		side = read
	} else {
		repo, err := s.repository()
		if err != nil {
			return feedback.Anchor{}, fail(contract.KindInternal, historyFailure+err.Error())
		}
		if repo == nil && !(draft.Compare.Kind == feedback.CompareWorking && draft.Side == feedback.SideNew) {
			return feedback.Anchor{}, rejectedAt("compare", "needs a git repository; the project has none")
		}
		view, err := s.view(*draft.Compare)
		if err != nil {
			if failure := compareProblem(err); failure != nil {
				return feedback.Anchor{}, failure
			}
			return feedback.Anchor{}, compareFailure(err)
		}
		_, content = view.paths(draft.Path, draft.Side)
		read, err := s.read(view, content, draft.Side)
		if err != nil {
			return feedback.Anchor{}, fail(contract.KindInternal, "Couldn't read the file: "+err.Error())
		}
		side = read
	}
	if !side.Exists {
		if draft.Compare == nil {
			return feedback.Anchor{}, rejectedAt("path", "is not a file zero shows in the project (missing, excluded, or too deep)")
		}
		return feedback.Anchor{}, rejectedAt("path", "is not a file on the %s side of this compare", draft.Side)
	}
	snapshot, err := feedback.Capture(side, lines)
	var pastEnd *feedback.PastEndError
	switch {
	case errors.As(err, &pastEnd):
		return feedback.Anchor{}, rejectedAt("lines", "%s", pastEnd.Error())
	case errors.Is(err, feedback.ErrBinary), errors.Is(err, feedback.ErrTooLarge):
		return feedback.Anchor{}, rejectedAt("lines", "can't be anchored: %v; comment on the file instead", err)
	case err != nil:
		return feedback.Anchor{}, fail(contract.KindInternal, err.Error())
	}
	return feedback.Anchor{Path: content, Side: draft.Side, Lines: lines, Text: snapshot.Text, Before: snapshot.Before, After: snapshot.After, Blob: snapshot.Blob, Compare: draft.Compare}, nil
}

// compareProblem is the draft problem for a compare that names a branch or
// commit the repository lacks, or nil for other failures.
func compareProblem(err error) error {
	switch {
	case errors.Is(err, git.ErrUnknownBase):
		return rejectedAt("compare.base", "is not a branch zero lists")
	case errors.Is(err, git.ErrUnknownHead):
		return rejectedAt("compare.head", "is not a local branch")
	case errors.Is(err, git.ErrUnavailable):
		return rejectedAt("compare", "names an unavailable commit")
	case errors.Is(err, git.ErrRangeTooLarge):
		return rejectedAt("compare", "%s", err.Error())
	}
	return nil
}
