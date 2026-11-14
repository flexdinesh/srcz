package files

import (
	"errors"
	"io"
	"os"
)

// Readable opens dir and reads one entry: nil when zero can list it, else
// the failure (decision 0146).
func Readable(dir string) error {
	file, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	if _, err := file.Readdirnames(1); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}
