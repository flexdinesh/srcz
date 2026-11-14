package contract

// Source control error codes (decisions 0024, 0030, 0040).
const (
	// CodeUnchanged marks a not-found diff of a path with no changes in the
	// compare.
	CodeUnchanged = "unchanged"
	// CodeUnknownBase marks an invalid base branch /api/refs does not list.
	CodeUnknownBase = "unknownBase"
	// CodeUnknownHead marks an invalid head that is not a local branch
	// /api/refs lists.
	CodeUnknownHead = "unknownHead"
	// CodeBlameUnavailable marks a blame refused for the file's content
	// (decision 0139): binary (unprocessable) or over 4 MiB (too large).
	CodeBlameUnavailable = "blameUnavailable"
)

// Code navigation error codes (decision 0018): every navigation failure
// carries one.
const (
	// CodeNavigationUnavailable: the project or file is unavailable or
	// cannot navigate.
	CodeNavigationUnavailable = "unavailable"
	// CodeNavigationInvalid: no file, or an invalid line or column.
	CodeNavigationInvalid = "invalid"
	// CodeNavigationUnsupported: no language server serves the file.
	CodeNavigationUnsupported = "unsupported"
	// CodeNavigationDisabled: the request did not authorize language servers.
	CodeNavigationDisabled = "disabled"
	// CodeNavigationMissing: the language server is not installed.
	CodeNavigationMissing = "missing"
	// CodeNavigationStarting: the language server is still starting.
	CodeNavigationStarting = "starting"
	// CodeNavigationTimeout: the language server did not answer in time.
	CodeNavigationTimeout = "timeout"
	// CodeNavigationUnsupportedMethod: the server lacks the method.
	CodeNavigationUnsupportedMethod = "unsupported-method"
	// CodeNavigationFailed: the language server failed.
	CodeNavigationFailed = "failed"
)

// Walkthrough error codes (decision 0047); a missing walkthrough is
// CodeWalkthroughUnavailable.
const (
	// CodeInvalidWalkthrough: the draft is not strict JSON, is malformed, or
	// names targets the project lacks.
	CodeInvalidWalkthrough = "invalidWalkthrough"
	// CodeWalkthroughTooLarge: the draft is over 1 MiB encoded.
	CodeWalkthroughTooLarge = "tooLarge"
	// CodeForeignOrigin: a browser on another site sent the write.
	CodeForeignOrigin = "foreignOrigin"
)

// Feedback error codes (decision 0120).
const (
	// CodeInvalidFeedback: the draft is not strict JSON, is malformed, or
	// names lines, paths, or threads the feedback or project lacks.
	CodeInvalidFeedback = "invalidFeedback"
	// CodeFeedbackUnavailable: no feedback has that ID, or the project's
	// repository has none for the branch.
	CodeFeedbackUnavailable = "feedbackUnavailable"
	// CodeFeedbackFull: the feedback, thread, or repository is at its limit.
	CodeFeedbackFull = "feedbackFull"
)

// Root error codes (decision 0146).
const (
	// CodePrivacyBlocked: macOS privacy protection kept zero from reading
	// the folder.
	CodePrivacyBlocked = "privacyBlocked"
	// CodeFolderUnreadable: zero cannot read the folder (permissions or an
	// I/O failure).
	CodeFolderUnreadable = "folderUnreadable"
	// CodeRootsUnmanaged: this server serves a fixed set of folders.
	CodeRootsUnmanaged = "rootsUnmanaged"
	// CodeNotServed: the path is not a served root.
	CodeNotServed = "notServed"
)
