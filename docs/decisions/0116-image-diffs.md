# 0116: Image diffs

- Status: Accepted
- Date: 2026-11-09
- Extends: [0004](0004-binary-and-size-limits.md) (raster images
  in diffs), [0035](0035-compare-list-and-review-tab.md) (review files),
  [0083](0083-server-structured-diffs.md) (diff sides)

## Context

A changed PNG in a review read "Binary file changed · 12 KB → 14 KB". To see
the change, a reviewer had to open the file and find the old version
elsewhere. `/api/image` served only working-tree images (Markdown image
dependencies), and a diff side did not say which commit it came from, so
the browser could not ask for the old image.

## Decision

- `/api/image` (`Documents.OpenImage`, `ReadImage`; `contract.ImageRequest`)
  takes `at=<full hash>`. With it, srcz reads the path from that commit's
  tree through `git.CommitBlob`: image media types only, paths git's own
  validation accepts (no `..`, no `.git`), and at most
  `contract.MaxImageBytes` (32 MiB). The response carries the length and the
  raw-file sandbox CSP. An invalid hash is invalid (400, "That commit hash is
  invalid."); an image over the limit is too large; an unknown commit, a
  path the commit lacks, a non-image, or a folder project is not found.
  Without `at`, nothing changes. Every Go transport reads it identically.
- Each committed diff side names its commit: `DiffSide.commit`, a full hash,
  absent for the working tree. `git.Blob` carries the commit it was read
  from (HEAD, a commit, its first parent, or a merge base), so the side is
  the one the diff actually read, even if HEAD moves.
- The review shows a raster image (an image preview kind without a text
  source) from those sides: the old side at its commit (HEAD for
  Uncommitted, the parent for a commit, the merge base or the range's
  oldest parent for branches and ranges), the new side at the head commit or
  from the working tree. A working-tree URL carries the diff read's
  revision, so a live reread loads it again.
- Modes: 2-up (default) shows both with dimensions and size; Swipe clips the
  new image left of a handle; Onion skin fades it over the old. Both share a
  stage sized to the larger image, from the top left. A Slider primitive
  drives both; dragging across the Swipe stage moves its handle. Added and
  deleted images show their one side.
- The mode holds per review tab. Diff options (`srcz-diff-options`) are
  toolbar state for every file; an image mode set from one file's own control
  would need a setter threaded through the review, so it stays tab state.
- A side over 32 MiB, an old side without a commit, or an image that fails
  to load shows the binary notice. SVG keeps its text diff.

## Consequences

- Image bytes at a commit are a new read: confined to the commit's tree and
  bounded like every other client read. The browser reads each side once;
  the shown elements reuse the loaded image.
- srcz RSS, on a repository of ten 2.8 MB noise PNGs changed in HEAD and in
  the working tree, after five rounds of reading every file's working and
  commit diff and its working-tree image: 17-19 MB idle and 23 MB after
  before the change; 17-18 MB idle and 23 MB after with the change, which
  also read both sides of every image at their commits (100 more reads of
  2.8 MB). Blobs stream from git to the response.
- Mode and slider positions reset when the tab closes.
