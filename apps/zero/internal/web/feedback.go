package web

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"strconv"

	"github.com/flexdinesh/zero/internal/app"
	"github.com/flexdinesh/zero/pkg/contract"
)

// Review feedback (decision 0120) is read and written by the browser and by
// agents through app.Feedback. Writes take the walkthrough guards: JSON
// only, at most 1 MiB, and no foreign Origin.

// compareQueryNames are the query parameters a compare takes, as
// /api/compare-stats reads them.
var compareQueryNames = []string{"base", "head", "uncommitted", "commit", "from", "to"}

func (a *App) serveFeedback(w http.ResponseWriter, r *http.Request, query url.Values) {
	request := contract.FeedbackRequest{Project: query.Get("project"), ID: query.Get("id")}
	if query.Has("compare") {
		request.Compare = &contract.FeedbackCompare{
			Kind: contract.FeedbackCompareKind(query.Get("compare")),
			Base: query.Get("base"), Head: query.Get("head"), Uncommitted: query.Has("uncommitted"),
			Commit: query.Get("commit"), From: query.Get("from"), To: query.Get("to"),
		}
	}
	if problem := feedbackQueryProblem(query); problem != "" {
		if _, err := a.app.Projects.Resolve(request.Project); err != nil {
			writeError(w, err)
			return
		}
		writeQueryError(w, problem)
		return
	}
	stored, err := a.app.Feedback.Get(r.Context(), request)
	writeResult(w, stored, err)
}

// feedbackQueryProblem rejects compare parameters without a compare and an
// uncommitted other than 1.
func feedbackQueryProblem(query url.Values) string {
	if !query.Has("compare") {
		for _, name := range compareQueryNames {
			if query.Has(name) {
				return "Name the compare that " + name + " belongs to: compare=working, branch, commit, or range."
			}
		}
		return ""
	}
	if query.Has("uncommitted") && query.Get("uncommitted") != "1" {
		return "Uncommitted must be 1."
	}
	return ""
}

// writeFeedbackGuards refuses a feedback write from another site or not in
// JSON; it reports whether it did.
func writeFeedbackGuards(w http.ResponseWriter, r *http.Request) bool {
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "Feedback can't be changed from another site.", Code: contract.CodeForeignOrigin})
		return true
	}
	if r.Method != http.MethodPost {
		return false
	}
	if mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, errorResponse{Error: "Send feedback as Content-Type: application/json.", Code: contract.CodeUnsupportedMediaType})
		return true
	}
	return false
}

// writeDraftError answers a draft that could not be decoded: 413 past the
// body limit, else 400; both with code invalidFeedback.
func writeDraftError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: fmt.Sprintf("A feedback request is at most %d bytes.", app.MaxFeedbackBytes), Code: contract.CodeInvalidFeedback})
		return
	}
	writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error(), Code: contract.CodeInvalidFeedback})
}

func (a *App) serveCreateFeedbackThread(w http.ResponseWriter, r *http.Request) {
	if writeFeedbackGuards(w, r) {
		return
	}
	draft, err := app.DecodeFeedbackThreadDraft(http.MaxBytesReader(w, r.Body, app.MaxFeedbackBytes))
	if err != nil {
		writeDraftError(w, err)
		return
	}
	thread, err := a.app.Feedback.CreateThread(r.Context(), draft)
	writeResult(w, thread, err)
}

func (a *App) servePostFeedbackMessage(w http.ResponseWriter, r *http.Request) {
	if writeFeedbackGuards(w, r) {
		return
	}
	draft, err := app.DecodeFeedbackMessageDraft(http.MaxBytesReader(w, r.Body, app.MaxFeedbackBytes))
	if err != nil {
		writeDraftError(w, err)
		return
	}
	thread, err := a.app.Feedback.PostMessage(r.Context(), draft)
	writeResult(w, thread, err)
}

// serveDeleteFeedback removes one thread (thread set) or a whole feedback.
func (a *App) serveDeleteFeedback(w http.ResponseWriter, r *http.Request, thread bool) {
	if writeFeedbackGuards(w, r) {
		return
	}
	query := r.URL.Query()
	request := contract.FeedbackDeleteRequest{Project: query.Get("project"), ID: query.Get("id")}
	var err error
	if thread {
		// A missing or malformed number is thread 0, which the app rejects.
		request.Thread, _ = strconv.Atoi(query.Get("thread"))
		err = a.app.Feedback.DeleteThread(request)
	} else {
		err = a.app.Feedback.Delete(request)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
