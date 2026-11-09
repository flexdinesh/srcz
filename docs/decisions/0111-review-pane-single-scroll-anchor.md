# 0111: One scroll anchor for the review pane

- Status: Accepted
- Date: 2026-11-09
- Extends: [0035](0035-compare-list-and-review-tab.md)'s review tab, which
  stacks a compare's file diffs in Pierre's virtualizer

## Context

Scrolling a long review with a trackpad in the desktop app jumped up and down.
The review pane had two scroll anchors: the browser's native scroll anchoring
(`overflow-anchor: auto`, the default on `main`) and Pierre's `Virtualizer`,
which records a line's offset before each render and scrolls by any difference
afterwards (`scrollFix`). Pierre's own `CodeView` turns native anchoring off on
its root; the bare `Virtualizer` the review uses does not.

In Chromium the two agree, so Pierre never corrects. In WebKit (measured on
Playwright WebKit 26.6) native anchoring picks another anchor and moves the
pane while rows render, and Pierre then scrolls that move straight back: every
correction equalled the scroll since its anchor was read (−154 to −4070 px).
Under trackpad momentum each of those programmatic scrolls is a visible jump.

Wheel steps over a 53-file commit review, counting Pierre's corrections that
undid a scroll rather than a layout change:

| Engine | Native anchoring | Undoing corrections (down, no wrap / up, wrap) | Layout corrections |
| --- | --- | --- | --- |
| WebKit | on | 2 / 9 | some |
| WebKit | off | 0 / 0 | 4 (wrapped row heights) |
| Chromium | on | 0 / 0 | 0 (native anchoring corrects) |
| Chromium | off | 0 / 0 | 4 (the same as WebKit) |

## Decision

**The virtualizer is the review pane's only scroll anchor.** While a review's
virtualizer is set up, the pane sets `overflow-anchor: none`; cleanup removes
it, so Source and other documents in the same `main` keep native anchoring. A
review hidden behind another tab runs its cleanup too (`Activity`).

## Consequences

- WebKit no longer scrolls a review back against the user's scroll.
- In Chromium, wrapped rows' height corrections come from Pierre's scrolls
  instead of native anchoring, in the same amounts.
- Height changes outside Pierre's diffs above the viewport (a section's
  "Loading diff…" note becoming its diff) are no longer compensated. They
  happen only after a fragment jump into the middle followed by scrolling up.

## Rejected

- **Native anchoring only** (patch Pierre to skip `scrollFix`): WebKit's
  native anchor left forward skips of hundreds of pixels on its own.
- **Patch `scrollFix` to discount scroll since its anchor read**: keeps two
  anchors and a vendor patch, and WebKit's native skips remain.
