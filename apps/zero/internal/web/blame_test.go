package web

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/flexdinesh/zero/pkg/contract"
)

func TestBlameServesWorkingTreeAndCommitBlames(t *testing.T) {
	root := changesRepo(t)
	app := newTestApp(t, root)

	var edited contract.BlameResponse
	if status := requestJSON(t, app, "/api/blame?project=.&path=doc.md", &edited); status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	if !edited.Repository || edited.Path != "doc.md" || len(edited.Commit) != 40 || edited.LineCount != 1 || len(edited.Commits) != 0 ||
		!reflect.DeepEqual(edited.Ranges, []contract.BlameRange{{Start: 1, Count: 1, Kind: contract.BlameUncommitted, Commit: -1}}) {
		t.Fatalf("edited blame = %+v", edited)
	}

	var same contract.BlameResponse
	if status := requestJSON(t, app, "/api/blame?project=.&path=same.md&at="+edited.Commit, &same); status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	if same.Commit != edited.Commit || len(same.Commits) != 1 || same.Commits[0].Subject != "initial" ||
		!reflect.DeepEqual(same.Ranges, []contract.BlameRange{{Start: 1, Count: 1, Kind: contract.BlameCommit, OriginalLine: 1}}) {
		t.Fatalf("blame at HEAD = %+v", same)
	}

	for target, want := range map[string]struct {
		status int
		code   string
	}{
		"/api/blame?project=.&path=doc.md&at=HEAD": {http.StatusBadRequest, ""},
		"/api/blame?project=.":                     {http.StatusBadRequest, ""},
		"/api/blame?project=.&path=gone.md":        {http.StatusNotFound, ""},
		"/api/blame?project=.&path=data.bin":       {http.StatusUnprocessableEntity, contract.CodeBlameUnavailable},
		"/api/blame?project=.&path=large.txt":      {http.StatusRequestEntityTooLarge, contract.CodeBlameUnavailable},
	} {
		var failure contract.ErrorResponse
		if status := requestJSON(t, app, target, &failure); status != want.status || failure.Error == "" || failure.Code != want.code {
			t.Errorf("%s = %d %+v, want %d %q", target, status, failure, want.status, want.code)
		}
	}
}
