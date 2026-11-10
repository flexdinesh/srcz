package app

import "sync"

// noticeHub fans announcements out to subscribers without ever blocking the
// announcer. Its zero value is ready to use.
type noticeHub[T any] struct {
	mu          sync.Mutex
	closed      bool
	subscribers map[chan T]struct{}
	// listeners run under mu, so they must not block.
	listeners map[*func(T)]struct{}
}

// listen calls fn with each announcement until the returned function runs.
func (h *noticeHub[T]) listen(fn func(T)) func() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return func() {}
	}
	if h.listeners == nil {
		h.listeners = map[*func(T)]struct{}{}
	}
	h.listeners[&fn] = struct{}{}
	return func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.listeners, &fn)
	}
}

func (h *noticeHub[T]) subscribe() (<-chan T, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	notices := make(chan T, noticeBuffer)
	if h.closed {
		close(notices)
		return notices, func() {}
	}
	if h.subscribers == nil {
		h.subscribers = map[chan T]struct{}{}
	}
	h.subscribers[notices] = struct{}{}
	return notices, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if _, ok := h.subscribers[notices]; ok {
			delete(h.subscribers, notices)
			close(notices)
		}
	}
}

// announce sends notice to every subscriber, dropping a full subscriber's
// oldest notice to make room.
func (h *noticeHub[T]) announce(notice T) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for listener := range h.listeners {
		(*listener)(notice)
	}
	for notices := range h.subscribers {
		for sent := false; !sent; {
			select {
			case notices <- notice:
				sent = true
			default:
				// Full: drop the oldest, unless the reader just took it.
				select {
				case <-notices:
				default:
				}
			}
		}
	}
}

// close ends every subscription; later subscriptions start closed.
func (h *noticeHub[T]) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for notices := range h.subscribers {
		close(notices)
	}
	h.subscribers = nil
	h.listeners = nil
}
