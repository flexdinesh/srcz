package app

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	goruntime "runtime"
	"syscall"

	"github.com/flexdinesh/zero/internal/files"
	"github.com/flexdinesh/zero/pkg/contract"
)

// RootControl serves folders anywhere on the host and stops serving roots
// for clients (decision 0146). The daemon implements it, saving what
// changes; a CLI-served session has none.
type RootControl interface {
	// Open serves path, an absolute directory: a path within a root adds
	// nothing; otherwise it becomes a root, replacing the roots inside it.
	Open(path string) (contract.OpenedRoot, error)
	// Remove stops serving root, a served root, and returns the roots left.
	Remove(root string) ([]string, error)
}

// CheckFolder reports why zero cannot read folder, as FolderError does; nil
// when it can, or when folder is missing or not a directory, which callers
// report themselves.
func CheckFolder(folder string) error {
	err := files.Readable(folder)
	if err == nil || errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR) {
		return nil
	}
	return FolderError(folder, err)
}

// FolderError explains a read failure of folder: CodePrivacyBlocked when
// macOS privacy protection refused it, else CodeFolderUnreadable.
func FolderError(folder string, err error) *Error {
	binary, _ := os.Executable()
	return folderError(goruntime.GOOS, binary, folder, err)
}

// folderError is FolderError for a host OS and the serving binary. macOS
// answers EPERM, not EACCES, for folders its privacy protection guards
// (Desktop, Documents, Downloads, removable volumes).
func folderError(goos, binary, folder string, err error) *Error {
	if goos == "darwin" && errors.Is(err, syscall.EPERM) {
		allow := "zero"
		if binary != "" {
			allow = binary
		}
		return &Error{Kind: contract.KindForbidden, Code: contract.CodePrivacyBlocked, Message: fmt.Sprintf(
			"macOS blocked zero from reading %s. Allow %s in System Settings › Privacy & Security › Full Disk Access, then try again.", folder, allow)}
	}
	reason := err.Error()
	var pathError *fs.PathError
	if errors.As(err, &pathError) {
		reason = pathError.Err.Error()
	}
	return &Error{Kind: contract.KindForbidden, Code: contract.CodeFolderUnreadable, Message: fmt.Sprintf("zero can't read %s: %s.", folder, reason)}
}

// rootProblem is a root's Problem and ProblemCode: empty when zero can read
// it.
func rootProblem(root string) (string, string) {
	if err := CheckFolder(root); err != nil {
		failure := AsError(err)
		return failure.Message, failure.Code
	}
	return "", ""
}

// scanError explains a failed scan of a project folder: a folder zero cannot
// read is FolderError's, anything else internal.
func scanError(root string, err error) *Error {
	if failure := CheckFolder(root); failure != nil {
		return AsError(failure)
	}
	return fail(contract.KindInternal, err.Error())
}
