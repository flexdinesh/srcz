package feedback

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestDecodeIsStrict(t *testing.T) {
	var draft struct {
		Project string `json:"project"`
	}
	if err := Decode(strings.NewReader(`{"project": "/p"}`), &draft); err != nil || draft.Project != "/p" {
		t.Fatalf("Decode = %+v, %v", draft, err)
	}
	for name, input := range map[string]string{
		"unknown field": `{"project": "/p", "bogus": 1}`,
		"trailing data": `{"project": "/p"} {}`,
		"not an object": `[]`,
	} {
		if err := Decode(strings.NewReader(input), &draft); !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("Decode %s = %v, want ErrInvalidJSON", name, err)
		}
	}
}

func problemsOf(t *testing.T, err error) []string {
	t.Helper()
	var problems Problems
	if !errors.As(err, &problems) {
		t.Fatalf("error = %v, want Problems", err)
	}
	var lines []string
	for _, problem := range problems {
		lines = append(lines, problem.Field+": "+problem.Message)
	}
	return lines
}

func TestThreadDraftNormalizeReportsEveryProblem(t *testing.T) {
	draft := ThreadDraft{
		Project: "relative",
		ID:      "fb-ABCDEF",
		Compare: &Compare{Kind: "commit", Base: "main", Commit: "abc", Uncommitted: true},
		Path:    "../escape",
		Side:    "left",
		Lines:   []int{1, 2, 3},
		Body:    "   ",
		Author:  "robot",
	}
	_, err := draft.Normalize()
	want := []string{
		"project: must be an absolute directory",
		"id: must be fb- and six lowercase letters or digits, such as fb-3k2q8m",
		"compare.base: doesn't apply to a commit compare",
		"compare.commit: must be a full commit hash of 40 hexadecimal digits",
		"compare.uncommitted: doesn't apply to a commit compare",
		"path: must be a clean, project-relative path with forward slashes",
		`side: must be "new" or "old"`,
		"lines: must be [start, end], got 3 numbers",
		"body: is required",
		`author: must be "user" or "agent"`,
	}
	if got := problemsOf(t, err); !reflect.DeepEqual(got, want) {
		t.Errorf("problems =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestThreadDraftNormalize(t *testing.T) {
	hash := strings.Repeat("A", 40)
	draft, err := ThreadDraft{Project: " /p ", Compare: &Compare{Kind: "range", From: hash, To: hash}, Path: "a.go", Side: "old", Lines: []int{2, 3}, Body: " hi \n", Author: AuthorAgent, Name: " claude "}.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	if draft.Project != "/p" || draft.Body != "hi" || draft.Name != "claude" || draft.Compare.From != strings.ToLower(hash) || *draft.LinesRange() != (Lines{2, 3}) {
		t.Errorf("Normalize = %+v", draft)
	}
	if draft, err := (ThreadDraft{Project: "/p", Path: "a.go", Body: "hi", Author: AuthorUser}).Normalize(); err != nil || draft.Side != SideNew || draft.LinesRange() != nil {
		t.Errorf("defaults = %+v, %v; want the new side, file-level", draft, err)
	}

	cases := map[string]struct {
		draft ThreadDraft
		want  []string
	}{
		"old side without a compare": {ThreadDraft{Project: "/p", Path: "a", Side: SideOld, Body: "b", Author: AuthorUser}, []string{"side: is old, which needs a compare; Source threads use the new side"}},
		"lines reversed":             {ThreadDraft{Project: "/p", Path: "a", Lines: []int{4, 2}, Body: "b", Author: AuthorUser}, []string{"lines: end 2 is before start 4"}},
		"lines from zero":            {ThreadDraft{Project: "/p", Path: "a", Lines: []int{0, 2}, Body: "b", Author: AuthorUser}, []string{"lines: start must be at least 1"}},
		"body too long":              {ThreadDraft{Project: "/p", Path: "a", Body: strings.Repeat("b", MaxBodyBytes+1), Author: AuthorUser}, []string{"body: is longer than 16384 bytes"}},
		"user with a name":           {ThreadDraft{Project: "/p", Path: "a", Body: "b", Author: AuthorUser, Name: "me"}, []string{"name: applies to agent messages only"}},
		"uncommitted with a head":    {ThreadDraft{Project: "/p", Compare: &Compare{Kind: "branch", Head: "topic", Uncommitted: true}, Path: "a", Body: "b", Author: AuthorUser}, []string{"compare.head: doesn't apply with uncommitted: uncommitted changes are HEAD's"}},
		"commit without a hash":      {ThreadDraft{Project: "/p", Compare: &Compare{Kind: "commit"}, Path: "a", Body: "b", Author: AuthorUser}, []string{"compare.commit: is required for a commit compare"}},
		"unknown compare":            {ThreadDraft{Project: "/p", Compare: &Compare{Kind: "stash"}, Path: "a", Body: "b", Author: AuthorUser}, []string{`compare.kind: must be "working", "branch", "commit", or "range"`}},
		"no project or path":         {ThreadDraft{Body: "b", Author: AuthorUser}, []string{"project: is required: the project's absolute directory", "path: is required"}},
	}
	for name, test := range cases {
		_, err := test.draft.Normalize()
		if got := problemsOf(t, err); !reflect.DeepEqual(got, test.want) {
			t.Errorf("%s: problems = %q, want %q", name, got, test.want)
		}
	}
}

func TestMessageDraftNormalize(t *testing.T) {
	if _, err := (MessageDraft{Project: "/p", ID: "fb-3k2q8m", Thread: 1, Status: StatusResolved, Author: AuthorAgent}).Normalize(); err != nil {
		t.Errorf("a status without a body = %v, want accepted", err)
	}
	_, err := MessageDraft{Project: "/p", Thread: 0, Status: "done", Author: AuthorUser}.Normalize()
	want := []string{
		"id: is required: a feedback ID such as fb-3k2q8m",
		"thread: is required: a thread number from 1",
		`status: must be "open", "resolved", or "wontfix"`,
	}
	if got := problemsOf(t, err); !reflect.DeepEqual(got, want) {
		t.Errorf("problems = %q, want %q", got, want)
	}
	if _, err := (MessageDraft{Project: "/p", ID: "fb-3k2q8m", Thread: 1, Author: AuthorUser}).Normalize(); !reflect.DeepEqual(problemsOf(t, err), []string{"body: is required"}) {
		t.Errorf("no body and no status = %v", err)
	}
}

func TestThreadAwaiting(t *testing.T) {
	user := Message{Author: AuthorUser}
	agent := Message{Author: AuthorAgent}
	for _, test := range []struct {
		status   string
		messages []Message
		want     string
	}{
		{StatusOpen, []Message{user}, AwaitingAgent},
		{StatusOpen, []Message{user, agent}, AwaitingUser},
		{StatusResolved, []Message{user, agent}, AwaitingUser},
		{StatusResolved, []Message{user}, AwaitingNone},
		{StatusWontfix, []Message{agent, user}, AwaitingNone},
		{StatusOpen, nil, AwaitingNone},
	} {
		if got := (Thread{Status: test.status, Messages: test.messages}).Awaiting(); got != test.want {
			t.Errorf("Awaiting(%s, %d messages) = %s, want %s", test.status, len(test.messages), got, test.want)
		}
	}
}
