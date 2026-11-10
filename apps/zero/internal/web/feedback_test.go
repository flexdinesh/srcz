package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/flexdinesh/zero/internal/watch"
	"github.com/flexdinesh/zero/pkg/contract"
)

// feedbackApp serves roots with a private feedback store.
func feedbackApp(t *testing.T, roots ...string) *App {
	t.Helper()
	app, err := New(Config{Roots: testRoots(t, roots...), Depth: 5, LiveUpdates: watch.NewHub(watch.DefaultOptions()), FeedbackDirectory: filepath.Join(t.TempDir(), "feedback")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	return app
}

func feedbackRequest(t *testing.T, app *App, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Host = "127.0.0.1:7971"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	response := httptest.NewRecorder()
	app.ServeHTTP(response, req)
	return response
}

func decodeBody[T any](t *testing.T, response *httptest.ResponseRecorder) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatalf("body: %v\n%s", err, response.Body.String())
	}
	return value
}

func TestFeedbackEndpoints(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "notes.md"), "# Notes\n\nfirst\nsecond\n")
	app := feedbackApp(t, root)
	project := app.roots.List()[0]
	query := func(values url.Values) string {
		values.Set("project", project)
		return values.Encode()
	}

	response := feedbackRequest(t, app, http.MethodGet, "/api/feedback?"+query(url.Values{}), "", nil)
	if response.Code != http.StatusOK || response.Body.String() != `{"id":"","project":"`+project+`","branch":"","threads":[],"createdAt":"","updatedAt":""}`+"\n" {
		t.Fatalf("GET before any thread = %d %s", response.Code, response.Body.String())
	}

	draft := `{"project":"` + project + `","path":"notes.md","lines":[3,4],"body":"Merge these <b>lines</b>."}`
	response = feedbackRequest(t, app, http.MethodPost, "/api/feedback-threads", draft, map[string]string{"Origin": "http://127.0.0.1:7971"})
	if response.Code != http.StatusOK {
		t.Fatalf("POST thread = %d %s", response.Code, response.Body.String())
	}
	thread := decodeBody[contract.FeedbackThread](t, response)
	if thread.Number != 1 || thread.Messages[0].Author != contract.FeedbackAuthorUser || thread.Messages[0].BodyHTML != "<p>Merge these &lt;b&gt;lines&lt;/b&gt;.</p>\n" || thread.Location.State != contract.FeedbackAnchored {
		t.Errorf("thread = %+v", thread)
	}

	stored := decodeBody[contract.Feedback](t, feedbackRequest(t, app, http.MethodGet, "/api/feedback?"+query(url.Values{}), "", nil))
	if !strings.HasPrefix(stored.ID, "fb-") || len(stored.Threads) != 1 {
		t.Fatalf("GET = %+v", stored)
	}
	byID := feedbackRequest(t, app, http.MethodGet, "/api/feedback?"+query(url.Values{"id": {stored.ID}, "compare": {"working"}}), "", nil)
	if byID.Code != http.StatusOK || decodeBody[contract.Feedback](t, byID).ID != stored.ID {
		t.Errorf("GET by ID in the working compare = %d %s", byID.Code, byID.Body.String())
	}

	reply := `{"project":"` + project + `","id":"` + stored.ID + `","thread":1,"body":"Done.","status":"resolved","author":"agent","name":"claude"}`
	response = feedbackRequest(t, app, http.MethodPost, "/api/feedback-messages", reply, nil)
	if replied := decodeBody[contract.FeedbackThread](t, response); response.Code != http.StatusOK || replied.Status != contract.FeedbackStatusResolved || replied.Awaiting != contract.FeedbackAwaitingUser {
		t.Errorf("POST message = %d %s", response.Code, response.Body.String())
	}

	list := decodeBody[[]contract.FeedbackSummary](t, feedbackRequest(t, app, http.MethodGet, "/api/feedback-list?"+query(url.Values{}), "", nil))
	if len(list) != 1 || list[0].ID != stored.ID || list[0].AwaitingUser != 1 {
		t.Errorf("GET list = %+v", list)
	}

	shell := feedbackRequest(t, app, http.MethodGet, "/view?"+query(url.Values{"fb": {stored.ID}}), "", nil)
	if shell.Code != http.StatusOK {
		t.Errorf("/view with fb = %d", shell.Code)
	}

	if response := feedbackRequest(t, app, http.MethodDelete, "/api/feedback-threads?"+query(url.Values{"id": {stored.ID}, "thread": {"1"}}), "", nil); response.Code != http.StatusNoContent {
		t.Errorf("DELETE thread = %d %s", response.Code, response.Body.String())
	}
	if response := feedbackRequest(t, app, http.MethodDelete, "/api/feedback?"+query(url.Values{"id": {stored.ID}}), "", nil); response.Code != http.StatusNoContent {
		t.Errorf("DELETE feedback = %d %s", response.Code, response.Body.String())
	}
	missing := feedbackRequest(t, app, http.MethodGet, "/api/feedback?"+query(url.Values{"id": {stored.ID}}), "", nil)
	if body := decodeError(t, missing); missing.Code != http.StatusNotFound || body.Code != contract.CodeFeedbackUnavailable || body.Error != "no feedback "+stored.ID+" for this repository" {
		t.Errorf("GET deleted = %d %+v", missing.Code, body)
	}
}

func TestFeedbackEndpointFailures(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "notes.md"), "# Notes\n")
	app := feedbackApp(t, root)
	project := app.roots.List()[0]
	valid := `{"project":"` + project + `","path":"notes.md","body":"b"}`
	cases := []struct {
		name    string
		method  string
		target  string
		body    string
		headers map[string]string
		status  int
		code    string
		message string
	}{
		{"foreign origin", http.MethodPost, "/api/feedback-threads", valid, map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden, contract.CodeForeignOrigin, "Feedback can't be changed from another site."},
		{"foreign delete", http.MethodDelete, "/api/feedback?project=" + url.QueryEscape(project) + "&id=fb-aaaaaa", "", map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden, contract.CodeForeignOrigin, ""},
		{"not JSON", http.MethodPost, "/api/feedback-messages", valid, map[string]string{"Content-Type": "text/plain"}, http.StatusUnsupportedMediaType, contract.CodeUnsupportedMediaType, ""},
		{"unknown field", http.MethodPost, "/api/feedback-threads", `{"project":"` + project + `","path":"notes.md","body":"b","colour":1}`, nil, http.StatusBadRequest, contract.CodeInvalidFeedback, "invalid feedback JSON"},
		{"too large", http.MethodPost, "/api/feedback-threads", `{"body":"` + strings.Repeat("x", 1<<20) + `"}`, nil, http.StatusRequestEntityTooLarge, contract.CodeInvalidFeedback, "A feedback request is at most 1048576 bytes."},
		{"every problem", http.MethodPost, "/api/feedback-threads", `{"project":"` + project + `","path":"../x","side":"old","body":""}`, nil, http.StatusBadRequest, contract.CodeInvalidFeedback, "invalid feedback: path: must be a clean, project-relative path with forward slashes; side: is old, which needs a compare; Source threads use the new side; body: is required"},
		{"unknown ID", http.MethodGet, "/api/feedback?project=" + url.QueryEscape(project) + "&id=fb-zzzzzz", "", nil, http.StatusNotFound, contract.CodeFeedbackUnavailable, "no feedback fb-zzzzzz for this repository"},
		{"compare parameter alone", http.MethodGet, "/api/feedback?project=" + url.QueryEscape(project) + "&base=main", "", nil, http.StatusBadRequest, "", "Name the compare that base belongs to: compare=working, branch, commit, or range."},
		{"uncommitted not 1", http.MethodGet, "/api/feedback?project=" + url.QueryEscape(project) + "&compare=branch&uncommitted=yes", "", nil, http.StatusBadRequest, "", "Uncommitted must be 1."},
		{"bad compare", http.MethodGet, "/api/feedback?project=" + url.QueryEscape(project) + "&compare=commit&commit=abc", "", nil, http.StatusBadRequest, contract.CodeInvalidFeedback, "invalid feedback: compare.commit: must be a full commit hash of 40 hexadecimal digits"},
		{"no project", http.MethodGet, "/api/feedback-list", "", nil, http.StatusBadRequest, "", "No project was selected."},
		{"thread not a number", http.MethodDelete, "/api/feedback-threads?project=" + url.QueryEscape(project) + "&id=fb-aaaaaa&thread=one", "", nil, http.StatusBadRequest, contract.CodeInvalidFeedback, "invalid feedback: thread: is required: a thread number from 1"},
		{"missing thread", http.MethodPost, "/api/feedback-messages", `{"project":"` + project + `","id":"fb-aaaaaa","thread":1,"body":"b"}`, nil, http.StatusNotFound, contract.CodeFeedbackUnavailable, ""},
	}
	for _, test := range cases {
		response := feedbackRequest(t, app, test.method, test.target, test.body, test.headers)
		body := decodeError(t, response)
		if response.Code != test.status || body.Code != test.code || !strings.Contains(body.Error, test.message) {
			t.Errorf("%s = %d %+v; want %d %q containing %q", test.name, response.Code, body, test.status, test.code, test.message)
		}
	}
}

// A stream carries feedback changes of its own project's repository only.
func TestEventsCarryTheirRepositorysFeedback(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	for _, root := range []string{first, second} {
		writeTestFile(t, filepath.Join(root, "notes.md"), "# Notes\n")
	}
	app := feedbackApp(t, first, second)
	server := liveServer(t, app, 0)
	roots := app.roots.List()
	firstStream, secondStream := openEvents(t, server, roots[0]), openEvents(t, server, roots[1])
	for _, stream := range []*eventStream{firstStream, secondStream} {
		if event := stream.take(); event.name != "status" {
			t.Fatalf("first event = %+v, want status", event)
		}
	}
	comment := func(project string) {
		t.Helper()
		body := `{"project":"` + project + `","path":"notes.md","body":"b","author":"agent"}`
		if response := feedbackRequest(t, app, http.MethodPost, "/api/feedback-threads", body, nil); response.Code != http.StatusOK {
			t.Fatalf("POST = %d %s", response.Code, response.Body.String())
		}
	}
	comment(roots[1])
	comment(roots[0])
	for i, stream := range []*eventStream{firstStream, secondStream} {
		stored := decodeBody[contract.Feedback](t, feedbackRequest(t, app, http.MethodGet, "/api/feedback?project="+url.QueryEscape(roots[i]), "", nil))
		// The second project's change came first: a stream that carried it
		// would show its ID first.
		var got contract.FeedbackEvent
		stream.next("feedback", &got)
		if got.Project != roots[i] || got.ID != stored.ID || got.Author != contract.FeedbackAuthorAgent || got.Branch != "" || got.UpdatedAt != stored.UpdatedAt {
			t.Errorf("stream %d feedback = %+v, want %s updated %s", i, got, stored.ID, stored.UpdatedAt)
		}
	}
}
