package contract

// FeedbackAuthor names who wrote a feedback message (decision 0120).
type FeedbackAuthor string

const (
	FeedbackAuthorUser  FeedbackAuthor = "user"
	FeedbackAuthorAgent FeedbackAuthor = "agent"
)

// FeedbackStatus is a thread's state: open until resolved or declined.
type FeedbackStatus string

const (
	FeedbackStatusOpen     FeedbackStatus = "open"
	FeedbackStatusResolved FeedbackStatus = "resolved"
	FeedbackStatusWontfix  FeedbackStatus = "wontfix"
)

// FeedbackSide names which side's lines a thread anchors to: new (the
// working tree, a compare's head) or old (a compare's base).
type FeedbackSide string

const (
	FeedbackSideNew FeedbackSide = "new"
	FeedbackSideOld FeedbackSide = "old"
)

// FeedbackAnchorState is where a thread's anchored text is now: anchored at
// its lines (the content is unchanged), moved to other lines, or outdated
// (the text is gone).
type FeedbackAnchorState string

const (
	FeedbackAnchored FeedbackAnchorState = "anchored"
	FeedbackMoved    FeedbackAnchorState = "moved"
	FeedbackOutdated FeedbackAnchorState = "outdated"
)

// FeedbackAwaiting is who a thread waits on: the agent (open, and the last
// message is the user's), the user (the last message is the agent's), or
// nobody.
type FeedbackAwaiting string

const (
	FeedbackAwaitingNone  FeedbackAwaiting = "none"
	FeedbackAwaitingAgent FeedbackAwaiting = "agent"
	FeedbackAwaitingUser  FeedbackAwaiting = "user"
)

// FeedbackCompareKind names the compare a thread was written in.
type FeedbackCompareKind string

const (
	FeedbackCompareWorking FeedbackCompareKind = "working"
	FeedbackCompareBranch  FeedbackCompareKind = "branch"
	FeedbackCompareCommit  FeedbackCompareKind = "commit"
	FeedbackCompareRange   FeedbackCompareKind = "range"
)

// FeedbackCompare names a Source Control compare as walkthroughs do: working,
// branch (Base to Head), commit (Commit against its first parent), or range
// (From's parent to To). Hashes are full.
type FeedbackCompare struct {
	Kind        FeedbackCompareKind `json:"kind"`
	Base        string              `json:"base,omitempty"`
	Head        string              `json:"head,omitempty"`
	Uncommitted bool                `json:"uncommitted"`
	Commit      string              `json:"commit,omitempty"`
	From        string              `json:"from,omitempty"`
	To          string              `json:"to,omitempty"`
}

// FeedbackAnchor is where a thread was written. Lines is an inclusive,
// 1-based [start, end], absent for a file-level thread. Text holds the
// anchored lines as written, Before and After up to three lines around them,
// and Blob the side's git blob hash then. Compare is the compare it was
// written in, absent for Source.
type FeedbackAnchor struct {
	Path    string           `json:"path"`
	Side    FeedbackSide     `json:"side"`
	Lines   []int            `json:"lines,omitempty"`
	Text    []string         `json:"text,omitempty"`
	Before  []string         `json:"before,omitempty"`
	After   []string         `json:"after,omitempty"`
	Blob    string           `json:"blob,omitempty"`
	Compare *FeedbackCompare `json:"compare,omitempty"`
}

// FeedbackLocation is a thread's anchor resolved against what a request
// views: a compare's sides, or else the working tree (new side) and the
// thread's own compare (old side). Path follows renames; Lines is absent for
// a file-level thread and for an outdated one.
type FeedbackLocation struct {
	State FeedbackAnchorState `json:"state"`
	Path  string              `json:"path"`
	Side  FeedbackSide        `json:"side"`
	Lines []int               `json:"lines,omitempty"`
}

// FeedbackMessage is one message of a thread. Number counts from 1 within
// the thread. Name is the agent's own name, when it gave one. Status is the
// status this message set, absent when it set none.
type FeedbackMessage struct {
	Number   int            `json:"number"`
	Author   FeedbackAuthor `json:"author"`
	Name     string         `json:"name,omitempty"`
	Body     string         `json:"body"`
	BodyHTML string         `json:"bodyHTML"`
	Status   FeedbackStatus `json:"status,omitempty"`
	// CreatedAt is an RFC 3339 time.
	CreatedAt string `json:"createdAt"`
}

// FeedbackThread is one conversation at an anchor. Number counts from 1
// within the feedback and never repeats.
type FeedbackThread struct {
	Number   int               `json:"number"`
	Status   FeedbackStatus    `json:"status"`
	Awaiting FeedbackAwaiting  `json:"awaiting"`
	Anchor   FeedbackAnchor    `json:"anchor"`
	Location FeedbackLocation  `json:"location"`
	Messages []FeedbackMessage `json:"messages"`
	// CreatedAt is an RFC 3339 time.
	CreatedAt string `json:"createdAt"`
	// UpdatedAt is an RFC 3339 time.
	UpdatedAt string `json:"updatedAt"`
}

// Feedback is GET /api/feedback: a branch's threads, oldest first. ID is
// stable for the repository and branch (fb- and six base32 characters);
// Branch is "" for a detached HEAD.
type Feedback struct {
	ID      string           `json:"id"`
	Project string           `json:"project"`
	Branch  string           `json:"branch"`
	Threads []FeedbackThread `json:"threads"`
	// CreatedAt is an RFC 3339 time.
	CreatedAt string `json:"createdAt"`
	// UpdatedAt is an RFC 3339 time.
	UpdatedAt string `json:"updatedAt"`
}

// FeedbackSummary lists one branch's feedback, GET /api/feedback-list (an
// array, most recently updated first).
type FeedbackSummary struct {
	ID            string `json:"id"`
	Branch        string `json:"branch"`
	Threads       int    `json:"threads"`
	Open          int    `json:"open"`
	AwaitingAgent int    `json:"awaitingAgent"`
	AwaitingUser  int    `json:"awaitingUser"`
	// UpdatedAt is an RFC 3339 time.
	UpdatedAt string `json:"updatedAt"`
}

// FeedbackEvent is the project stream's and the control stream's
// "feedback": a branch's feedback changed. Author wrote the change.
type FeedbackEvent struct {
	Project string         `json:"project"`
	ID      string         `json:"id"`
	Branch  string         `json:"branch"`
	Author  FeedbackAuthor `json:"author"`
	// UpdatedAt is an RFC 3339 time.
	UpdatedAt string `json:"updatedAt"`
}
