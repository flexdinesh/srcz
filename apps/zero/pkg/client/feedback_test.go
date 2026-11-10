package client_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/flexdinesh/zero/pkg/client"
	"github.com/flexdinesh/zero/pkg/contract"
)

func TestFeedbackParityAcrossTransports(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	empty := f.same(t, "Feedback before any thread", func(c client.Client) outcome {
		return result(c.Feedback(ctx, contract.FeedbackRequest{Project: f.root}))
	})
	if got, ok := empty.Value.(contract.Feedback); !ok || empty.Err != nil || got.ID != "" || got.Branch != "" || len(got.Threads) != 0 {
		t.Fatalf("Feedback before any thread = %+v", empty)
	}
	rejected := f.same(t, "CreateFeedbackThread invalid", func(c client.Client) outcome {
		return result(c.CreateFeedbackThread(ctx, contract.FeedbackThreadDraft{Project: f.root, Path: "../x", Lines: []int{1}, Body: "b"}))
	})
	if kindOf(rejected.Err) != contract.KindInvalid || codeOf(rejected.Err) != contract.CodeInvalidFeedback || rejected.Err.Error() != "invalid feedback: path: must be a clean, project-relative path with forward slashes; lines: must be [start, end], got 1 numbers" {
		t.Errorf("CreateFeedbackThread invalid error = %v", rejected.Err)
	}
	f.same(t, "Feedback unknown ID", func(c client.Client) outcome {
		return result(c.Feedback(ctx, contract.FeedbackRequest{Project: f.root, ID: "fb-zzzzzz"}))
	})

	var daemon client.Client
	for _, transport := range f.transports {
		if transport.daemon {
			daemon = transport.client
		}
	}
	control, err := daemon.DaemonEvents(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	if first, err := control.Next(); err != nil || first.Name != contract.DaemonEventStatus {
		t.Fatalf("first control event = %+v, %v", first, err)
	}
	streams := make([]*client.Stream[contract.Event], len(f.transports))
	for i, transport := range f.transports {
		stream, err := transport.client.Events(ctx, contract.EventsRequest{Project: f.root})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		if event, err := stream.Next(); err != nil || event.Name != contract.EventStatus {
			t.Fatalf("first event over %s = %+v, %v", transport.name, event, err)
		}
		streams[i] = stream
	}

	// Each transport starts a thread; every stream hears each.
	for i, transport := range f.transports {
		thread, err := transport.client.CreateFeedbackThread(ctx, contract.FeedbackThreadDraft{Project: f.root, Path: "README.md", Lines: []int{1, 1}, Body: "From **" + transport.name + "**."})
		if err != nil || thread.Number != i+1 || thread.Anchor.Text[0] != "# Hello" || thread.Messages[0].BodyHTML != "<p>From <strong>"+transport.name+"</strong>.</p>\n" {
			t.Fatalf("CreateFeedbackThread over %s = %+v, %v", transport.name, thread, err)
		}
		event, err := control.Next()
		if err != nil || event.Name != contract.DaemonEventFeedback || event.Feedback == nil || event.Feedback.Project != f.root || event.Feedback.Author != contract.FeedbackAuthorUser {
			t.Errorf("control announcement of %s = %+v, %v", transport.name, event, err)
		}
		for j, stream := range streams {
			if event := nextFeedback(t, stream); event.Project != f.root || !strings.HasPrefix(event.ID, "fb-") {
				t.Errorf("stream %s after %s = %+v", f.transports[j].name, transport.name, event)
			}
		}
	}

	read := f.same(t, "Feedback", func(c client.Client) outcome {
		return result(c.Feedback(ctx, contract.FeedbackRequest{Project: f.root}))
	})
	stored, ok := read.Value.(contract.Feedback)
	if !ok || read.Err != nil || len(stored.Threads) != len(f.transports) || stored.Threads[0].Location.State != contract.FeedbackAnchored {
		t.Fatalf("Feedback = %+v", read)
	}
	f.same(t, "Feedback by ID in the working compare", func(c client.Client) outcome {
		return result(c.Feedback(ctx, contract.FeedbackRequest{Project: f.root, ID: stored.ID, Compare: &contract.FeedbackCompare{Kind: contract.FeedbackCompareWorking}}))
	})

	for i, transport := range f.transports {
		thread, err := transport.client.PostFeedbackMessage(ctx, contract.FeedbackMessageDraft{Project: f.root, ID: stored.ID, Thread: i + 1, Body: "Done.", Status: contract.FeedbackStatusResolved, Author: contract.FeedbackAuthorAgent, Name: "claude"})
		if err != nil || thread.Status != contract.FeedbackStatusResolved || thread.Awaiting != contract.FeedbackAwaitingUser {
			t.Errorf("PostFeedbackMessage over %s = %+v, %v", transport.name, thread, err)
		}
	}
	list := f.same(t, "FeedbackList", func(c client.Client) outcome {
		return result(c.FeedbackList(ctx, contract.FeedbackListRequest{Project: f.root}))
	})
	if got, ok := list.Value.([]contract.FeedbackSummary); !ok || len(got) != 1 || got[0].AwaitingUser != len(f.transports) || got[0].Open != 0 {
		t.Errorf("FeedbackList = %+v", list)
	}

	for i, transport := range f.transports {
		if err := transport.client.DeleteFeedbackThread(ctx, contract.FeedbackDeleteRequest{Project: f.root, ID: stored.ID, Thread: i + 1}); err != nil {
			t.Errorf("DeleteFeedbackThread over %s = %v", transport.name, err)
		}
	}
	gone := f.same(t, "DeleteFeedbackThread missing", func(c client.Client) outcome {
		return outcome{Err: c.DeleteFeedbackThread(ctx, contract.FeedbackDeleteRequest{Project: f.root, ID: stored.ID, Thread: 1})}
	})
	if codeOf(gone.Err) != contract.CodeInvalidFeedback {
		t.Errorf("DeleteFeedbackThread missing error = %v", gone.Err)
	}
	if err := f.transports[0].client.DeleteFeedback(ctx, contract.FeedbackDeleteRequest{Project: f.root, ID: stored.ID}); err != nil {
		t.Fatal(err)
	}
	missing := f.same(t, "DeleteFeedback missing", func(c client.Client) outcome {
		return outcome{Err: c.DeleteFeedback(ctx, contract.FeedbackDeleteRequest{Project: f.root, ID: stored.ID})}
	})
	if kindOf(missing.Err) != contract.KindNotFound || codeOf(missing.Err) != contract.CodeFeedbackUnavailable {
		t.Errorf("DeleteFeedback missing error = %v", missing.Err)
	}
}

// nextFeedback skips to a stream's next feedback event.
func nextFeedback(t *testing.T, stream *client.Stream[contract.Event]) contract.FeedbackEvent {
	t.Helper()
	type next struct {
		event contract.Event
		err   error
	}
	for {
		read := make(chan next, 1)
		go func() {
			event, err := stream.Next()
			read <- next{event, err}
		}()
		select {
		case got := <-read:
			if got.err != nil {
				t.Fatalf("stream: %v", got.err)
			}
			if got.event.Name == contract.EventFeedback && got.event.Feedback != nil {
				return *got.event.Feedback
			}
		case <-time.After(5 * time.Second):
			t.Fatal("no feedback event")
		}
	}
}
