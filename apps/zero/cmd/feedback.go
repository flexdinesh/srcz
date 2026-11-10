package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/flexdinesh/zero/internal/app"
	"github.com/flexdinesh/zero/internal/daemon"
	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/internal/feedback"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
	"github.com/spf13/cobra"
)

// Review feedback without a server (decision 0120): the CLI is the agent's
// interface. It reads and writes the store the server uses, through the
// application layer over the project as its own root, then tells a running
// daemon so open windows update.

// feedbackDepth bounds the working-tree files a comment may name, as a
// served project's default depth does.
const feedbackDepth = 5

// errFeedbackRejected is returned after a rejected request's problems are
// printed.
var errFeedbackRejected = errors.New("feedback not saved")

type feedbackOptions struct {
	cliName cliName
	project string
	json    bool
	// show
	all bool
	// reply and comment
	message    string
	hasMessage bool
	name       string
	resolve    bool
	wontfix    bool
	reopen     bool
	path       string
	lines      string
	// Test seams, not flags.
	feedbackDir string                 // "" uses feedback.DefaultDirectory()
	socket      string                 // "" uses daemon.DefaultSocket()
	getwd       func() (string, error) // nil uses os.Getwd
}

type feedbackRunner func(context.Context, feedbackOptions, []string, io.Reader, io.Writer, io.Writer) error

func newFeedbackCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "feedback",
		Short: "Read and answer review feedback without a running server",
		Long: "Review feedback threads start on diff and Source lines in zero. Agents read\n" +
			"the threads waiting on them and reply here; open windows update live.",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE:          func(command *cobra.Command, _ []string) error { return command.Help() },
	}
	add := func(use, short string, args cobra.PositionalArgs, run feedbackRunner, flags func(*cobra.Command, *feedbackOptions)) {
		var opts feedbackOptions
		sub := &cobra.Command{
			Use:           use,
			Short:         short,
			Args:          args,
			SilenceUsage:  true,
			SilenceErrors: true,
			RunE: func(command *cobra.Command, positional []string) error {
				opts.cliName = cliName(command.Root().Name())
				opts.hasMessage = command.Flags().Changed("message")
				return run(command.Context(), opts, positional, command.InOrStdin(), command.OutOrStdout(), command.ErrOrStderr())
			},
		}
		sub.Flags().BoolVar(&opts.json, "json", false, "print the result as JSON")
		flags(sub, &opts)
		command.AddCommand(sub)
	}
	projectFlag := func(command *cobra.Command, opts *feedbackOptions) {
		command.Flags().StringVar(&opts.project, "project", "", "the project directory (default: the current directory's repository)")
	}
	messageFlags := func(command *cobra.Command, opts *feedbackOptions) {
		command.Flags().StringVarP(&opts.message, "message", "m", "", "the message in Markdown; - reads standard input")
		command.Flags().StringVar(&opts.name, "name", "", "the agent's name, shown beside its messages")
	}
	add("show [id]", "Print the threads waiting on the agent (--all for every thread)", cobra.MaximumNArgs(1), showFeedback, func(command *cobra.Command, opts *feedbackOptions) {
		projectFlag(command, opts)
		command.Flags().BoolVar(&opts.all, "all", false, "print every thread, not only those awaiting the agent")
	})
	add("reply <id> <thread>", "Reply to a thread as the agent, optionally resolving it", cobra.ExactArgs(2), replyFeedback, func(command *cobra.Command, opts *feedbackOptions) {
		projectFlag(command, opts)
		messageFlags(command, opts)
		command.Flags().BoolVar(&opts.resolve, "resolve", false, "mark the thread resolved")
		command.Flags().BoolVar(&opts.wontfix, "wontfix", false, "decline the thread")
		command.Flags().BoolVar(&opts.reopen, "reopen", false, "reopen a resolved or declined thread")
		command.MarkFlagsMutuallyExclusive("resolve", "wontfix", "reopen")
	})
	add("comment [id]", "Start a thread as the agent on a working-tree file", cobra.MaximumNArgs(1), commentFeedback, func(command *cobra.Command, opts *feedbackOptions) {
		projectFlag(command, opts)
		messageFlags(command, opts)
		command.Flags().StringVar(&opts.path, "path", "", "the project-relative file path")
		command.Flags().StringVar(&opts.lines, "lines", "", "the lines, 12 or 12-20 (default: the whole file)")
		_ = command.MarkFlagRequired("path")
	})
	add("list", "List the repository's feedback, one per branch", cobra.NoArgs, listFeedback, projectFlag)
	return command
}

func showFeedback(ctx context.Context, opts feedbackOptions, args []string, _ io.Reader, stdout, stderr io.Writer) error {
	id := ""
	if len(args) == 1 {
		id = args[0]
	}
	session, err := openFeedback(opts, id)
	if err != nil {
		return err
	}
	stored, err := session.app.Feedback.Get(ctx, contract.FeedbackRequest{Project: session.root, ID: id})
	if err != nil {
		return reportFeedbackError(err, stderr)
	}
	shown := stored
	if !opts.all {
		shown.Threads = awaitingAgent(stored.Threads)
	}
	if opts.json {
		return writeJSONLine(stdout, shown)
	}
	_, err = io.WriteString(stdout, feedbackMarkdown(opts.cliName, stored, shown.Threads, opts.all))
	return err
}

func replyFeedback(ctx context.Context, opts feedbackOptions, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	id := args[0]
	number, err := strconv.Atoi(args[1])
	if err != nil || number < 1 {
		return fmt.Errorf("thread must be a number from 1, not %q", args[1])
	}
	status := contract.FeedbackStatus("")
	switch {
	case opts.resolve:
		status = contract.FeedbackStatusResolved
	case opts.wontfix:
		status = contract.FeedbackStatusWontfix
	case opts.reopen:
		status = contract.FeedbackStatusOpen
	}
	body, err := readMessage(opts, stdin, status != "")
	if err != nil {
		return err
	}
	session, err := openFeedback(opts, id)
	if err != nil {
		return err
	}
	thread, err := session.app.Feedback.PostMessage(ctx, contract.FeedbackMessageDraft{Project: session.root, ID: id, Thread: number, Body: body, Status: status, Author: contract.FeedbackAuthorAgent, Name: opts.name})
	if err != nil {
		return reportFeedbackError(err, stderr)
	}
	announceFeedbackToDaemon(ctx, opts.socket, session.root, id, stderr)
	if opts.json {
		return writeJSONLine(stdout, thread)
	}
	outcome := ""
	if status != "" {
		outcome = " (" + statusVerb(status) + ")"
	}
	_, err = fmt.Fprintf(stdout, "replied to thread %d%s\n", thread.Number, outcome)
	return err
}

func commentFeedback(ctx context.Context, opts feedbackOptions, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	id := ""
	if len(args) == 1 {
		id = args[0]
	}
	lines, err := parseLines(opts.lines)
	if err != nil {
		return err
	}
	body, err := readMessage(opts, stdin, false)
	if err != nil {
		return err
	}
	session, err := openFeedback(opts, id)
	if err != nil {
		return err
	}
	thread, err := session.app.Feedback.CreateThread(ctx, contract.FeedbackThreadDraft{Project: session.root, ID: id, Path: opts.path, Side: contract.FeedbackSideNew, Lines: lines, Body: body, Author: contract.FeedbackAuthorAgent, Name: opts.name})
	if err != nil {
		return reportFeedbackError(err, stderr)
	}
	if id == "" {
		// The thread joined the branch's feedback, created if missing.
		if stored, err := session.app.Feedback.Get(ctx, contract.FeedbackRequest{Project: session.root}); err == nil {
			id = stored.ID
		}
	}
	if id != "" {
		announceFeedbackToDaemon(ctx, opts.socket, session.root, id, stderr)
	}
	if opts.json {
		return writeJSONLine(stdout, thread)
	}
	_, err = fmt.Fprintf(stdout, "started thread %d at %s\n", thread.Number, rangeLabel(thread.Anchor.Path, thread.Anchor.Lines))
	return err
}

func listFeedback(_ context.Context, opts feedbackOptions, _ []string, _ io.Reader, stdout, stderr io.Writer) error {
	session, err := openFeedback(opts, "")
	if err != nil {
		return err
	}
	summaries, err := session.app.Feedback.List(contract.FeedbackListRequest{Project: session.root})
	if err != nil {
		return reportFeedbackError(err, stderr)
	}
	if opts.json {
		return writeJSONLine(stdout, summaries)
	}
	if len(summaries) == 0 {
		_, err := fmt.Fprintf(stdout, "No feedback in %s yet.\n", session.root)
		return err
	}
	for _, summary := range summaries {
		branch := summary.Branch
		if branch == "" {
			branch = "(detached HEAD)"
		}
		if _, err := fmt.Fprintf(stdout, "%s  %s  %s, %d awaiting you\n", summary.ID, branch, count(summary.Threads, "thread"), summary.AwaitingAgent); err != nil {
			return err
		}
	}
	return nil
}

// feedbackSession is the application layer over one project, its own root.
type feedbackSession struct {
	root string
	app  *app.App
}

// openFeedback finds the project a command works in: --project, or else the
// current directory's repository. A feedback ID that repository lacks is
// read where it was last written, when that directory still exists.
func openFeedback(opts feedbackOptions, id string) (feedbackSession, error) {
	directory := opts.feedbackDir
	if directory == "" {
		var err error
		if directory, err = feedback.DefaultDirectory(); err != nil {
			return feedbackSession{}, err
		}
	}
	dir := opts.project
	if dir == "" {
		getwd := opts.getwd
		if getwd == nil {
			getwd = os.Getwd
		}
		wd, err := getwd()
		if err != nil {
			return feedbackSession{}, err
		}
		dir = wd
	}
	root, err := repositoryRoot(dir)
	if err != nil {
		return feedbackSession{}, err
	}
	if id != "" && opts.project == "" {
		store := feedback.NewStore(directory)
		if _, err := store.Get(app.FeedbackRepository(root), id); errors.Is(err, feedback.ErrNotFound) {
			if located, err := store.Locate(id); err == nil {
				if elsewhere, err := projects.ResolveStandalone(located.Project); err == nil && app.FeedbackRepository(elsewhere) == located.Repository {
					root = elsewhere
				}
			}
		}
	}
	roots, err := projects.NewRootSet([]string{root})
	if err != nil {
		return feedbackSession{}, err
	}
	application, err := app.New(app.Config{Roots: roots, Depth: feedbackDepth, Types: document.Builtins(), FeedbackDirectory: directory})
	if err != nil {
		return feedbackSession{}, err
	}
	return feedbackSession{root: root, app: application}, nil
}

// repositoryRoot is the project that shows dir: its repository's root, or
// the folder itself outside any repository.
func repositoryRoot(dir string) (string, error) {
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	for candidate := absolute; ; candidate = filepath.Dir(candidate) {
		root, err := projects.ResolveStandalone(candidate)
		switch {
		case err == nil:
			return root, nil
		case !errors.Is(err, projects.ErrInsideRepository):
			return "", fmt.Errorf("project %s must be an existing directory", dir)
		case candidate == filepath.Dir(candidate):
			return "", fmt.Errorf("project %s has no repository root", dir)
		}
	}
}

// readMessage reads -m: the text, or standard input for -. A status may
// stand without a message.
func readMessage(opts feedbackOptions, stdin io.Reader, optional bool) (string, error) {
	if !opts.hasMessage {
		if optional {
			return "", nil
		}
		return "", errors.New("give a message with -m TEXT, or -m - to read standard input")
	}
	if opts.message != "-" {
		return opts.message, nil
	}
	contents, err := io.ReadAll(io.LimitReader(stdin, feedback.MaxBodyBytes+1))
	if err != nil {
		return "", fmt.Errorf("read message: %w", err)
	}
	return string(contents), nil
}

// parseLines reads --lines: 12 or 12-20; empty is file-level.
func parseLines(value string) ([]int, error) {
	if value == "" {
		return nil, nil
	}
	first, last, ranged := strings.Cut(value, "-")
	start, err := strconv.Atoi(first)
	end := start
	if err == nil && ranged {
		end, err = strconv.Atoi(last)
	}
	if err != nil {
		return nil, fmt.Errorf("--lines must be a line or a range such as 12-20, not %q", value)
	}
	return []int{start, end}, nil
}

// reportFeedbackError prints a rejected request's problems and returns
// errFeedbackRejected; other failures return their message.
func reportFeedbackError(err error, stderr io.Writer) error {
	var rejection *app.FeedbackRejected
	if errors.As(err, &rejection) {
		_, _ = fmt.Fprintln(stderr, "invalid feedback:")
		for _, problem := range rejection.Problems {
			_, _ = fmt.Fprintf(stderr, "  %s: %s\n", problem.Field, problem.Message)
		}
		return errFeedbackRejected
	}
	return errors.New(app.AsError(err).Message)
}

// announceFeedbackToDaemon tells a running daemon about a change so its windows
// update. A daemon that is not running, unreachable, or not serving the
// project is ignored; one that serves the project but reads another store
// gets a warning.
func announceFeedbackToDaemon(ctx context.Context, socket, project, id string, stderr io.Writer) {
	if daemonSupported() != nil {
		return
	}
	socket, err := resolveSocket(socket)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, announceTimeout)
	defer cancel()
	err = daemon.NewClient(socket).AnnounceFeedback(ctx, project, id, contract.FeedbackAuthorAgent)
	var failure *daemon.ControlError
	if errors.As(err, &failure) && failure.Status == http.StatusNotFound && failure.Code == contract.CodeFeedbackUnavailable {
		_, _ = fmt.Fprintf(stderr, "zero daemon at %s serves this project but keeps feedback elsewhere\n", socket)
	}
}

func writeJSONLine(w io.Writer, value any) error {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func awaitingAgent(threads []contract.FeedbackThread) []contract.FeedbackThread {
	result := []contract.FeedbackThread{}
	for _, thread := range threads {
		if thread.Awaiting == contract.FeedbackAwaitingAgent {
			result = append(result, thread)
		}
	}
	return result
}

// feedbackMarkdown is `zero feedback show`'s Markdown: a header, the reply
// command, and each of threads with its anchored text and messages. The web
// app's Copy as Markdown writes the same text (testdata/feedback/markdown.md
// pins both). Each fence names the anchor's language, bare when it has none.
func feedbackMarkdown(name cliName, stored contract.Feedback, threads []contract.FeedbackThread, all bool) string {
	var out strings.Builder
	branch := "Detached HEAD"
	if stored.Branch != "" {
		branch = "Branch " + stored.Branch
	}
	if stored.ID == "" {
		fmt.Fprintf(&out, "No feedback for %s in %s yet.\n", strings.ToLower(branch[:1])+branch[1:], stored.Project)
		return out.String()
	}
	waiting := len(awaitingAgent(stored.Threads))
	awaiting := count(waiting, "thread") + " awaiting you"
	if waiting == 0 {
		awaiting = "no threads awaiting you"
	}
	fmt.Fprintf(&out, "# Feedback %s\n%s · %s · %s\n", stored.ID, branch, stored.Project, awaiting)
	switch {
	case len(threads) == 0 && all:
		out.WriteString("\nNo threads yet.\n")
		return out.String()
	case len(threads) == 0:
		out.WriteString("\nNo threads awaiting you. Use --all to list every thread.\n")
		return out.String()
	}
	fmt.Fprintf(&out, "\nReply: %s feedback reply %s <thread> -m \"<what you did>\" [--resolve | --wontfix]\n", name, stored.ID)
	for _, thread := range threads {
		out.WriteString("\n")
		writeThreadMarkdown(&out, thread)
	}
	return out.String()
}

// writeThreadMarkdown writes one thread: its heading, its anchored text
// fenced, and its messages.
func writeThreadMarkdown(out *strings.Builder, thread contract.FeedbackThread) {
	fmt.Fprintf(out, "## Thread %d · %s · %s\n", thread.Number, statusLabel(thread.Status), locationLabel(thread))
	if len(thread.Anchor.Text) > 0 {
		text := strings.Join(thread.Anchor.Text, "\n")
		fence := strings.Repeat("`", max(3, longestRun(text, '`')+1))
		fmt.Fprintf(out, "%s%s\n%s\n%s\n", fence, thread.Anchor.Language, text, fence)
	}
	for i, message := range thread.Messages {
		if i > 0 {
			out.WriteString("\n")
		}
		author := string(message.Author)
		if message.Name != "" {
			author += " (" + message.Name + ")"
		}
		fmt.Fprintf(out, "**%s** · %s", author, messageTime(message.CreatedAt))
		if message.Status != "" {
			fmt.Fprintf(out, " · %s", statusVerb(message.Status))
		}
		out.WriteString("\n")
		if body := strings.TrimRight(message.Body, "\n"); body != "" {
			out.WriteString(body + "\n")
		}
	}
}

// locationLabel is path:start or path:start-end, marked (old side), (moved
// from …), or outdated; path (file) for a file-level thread.
func locationLabel(thread contract.FeedbackThread) string {
	location := thread.Location
	lines := location.Lines
	if location.State == contract.FeedbackOutdated {
		lines = thread.Anchor.Lines
	}
	label := location.Path
	if len(thread.Anchor.Lines) == 2 {
		label = rangeLabel(location.Path, lines)
	} else {
		label += " (file)"
	}
	if location.Side == contract.FeedbackSideOld {
		label += " (old side)"
	}
	if location.State == contract.FeedbackMoved && len(thread.Anchor.Lines) == 2 {
		label += " (moved from " + linesText(thread.Anchor.Lines) + ")"
	}
	if location.State == contract.FeedbackOutdated {
		label += " · outdated, code no longer present"
	}
	return label
}

func rangeLabel(path string, lines []int) string {
	if len(lines) != 2 {
		return path
	}
	return path + ":" + linesText(lines)
}

func linesText(lines []int) string {
	if lines[0] == lines[1] {
		return strconv.Itoa(lines[0])
	}
	return strconv.Itoa(lines[0]) + "-" + strconv.Itoa(lines[1])
}

func statusLabel(status contract.FeedbackStatus) string {
	if status == contract.FeedbackStatusWontfix {
		return "won't fix"
	}
	return string(status)
}

// statusVerb is what a message setting status did.
func statusVerb(status contract.FeedbackStatus) string {
	switch status {
	case contract.FeedbackStatusResolved:
		return "resolved"
	case contract.FeedbackStatusWontfix:
		return "won't fix"
	}
	return "reopened"
}

// messageTime is an RFC 3339 time as 2006-01-02 15:04 UTC.
func messageTime(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return value
	}
	return parsed.UTC().Format("2006-01-02 15:04") + " UTC"
}

func longestRun(text string, r byte) int {
	longest, run := 0, 0
	for i := range len(text) {
		if text[i] == r {
			run++
			longest = max(longest, run)
		} else {
			run = 0
		}
	}
	return longest
}

func count(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return strconv.Itoa(n) + " " + noun + "s"
}
