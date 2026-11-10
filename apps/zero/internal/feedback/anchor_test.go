package feedback

import (
	"reflect"
	"strings"
	"testing"
)

func TestBlobHashMatchesGit(t *testing.T) {
	// git hash-object of "hello\n" and of an empty file.
	for content, want := range map[string]string{
		"hello\n": "ce013625030ba8dba906f756967f9e9ca394464a",
		"":        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
	} {
		if got := BlobHash([]byte(content)); got != want {
			t.Errorf("BlobHash(%q) = %s, want %s", content, got, want)
		}
	}
}

func TestCaptureRecordsTextContextAndBlob(t *testing.T) {
	content := []byte("one\ntwo\r\nthree\nfour\nfive\nsix\nseven\n")
	lines := Lines{4, 5}
	got, err := Capture(Side{Exists: true, Content: content}, &lines)
	if err != nil {
		t.Fatal(err)
	}
	want := Snapshot{Text: []string{"four", "five"}, Before: []string{"one", "two", "three"}, After: []string{"six", "seven"}, Blob: BlobHash(content)}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Capture = %+v, want %+v", got, want)
	}

	edge := Lines{1, 1}
	got, err = Capture(Side{Exists: true, Content: []byte("only")}, &edge)
	if err != nil || !reflect.DeepEqual(got.Text, []string{"only"}) || got.Before != nil || got.After != nil {
		t.Errorf("Capture of a one-line file = %+v, %v", got, err)
	}
}

func TestCaptureKeepsTheFirstLinesWithinLimits(t *testing.T) {
	var many []string
	for i := range 30 {
		many = append(many, "line "+string(rune('a'+i%26)))
	}
	lines := Lines{1, 30}
	got, err := Capture(Side{Exists: true, Content: []byte(strings.Join(many, "\n"))}, &lines)
	if err != nil || !reflect.DeepEqual(got.Text, many[:MaxAnchorLines]) {
		t.Errorf("Capture of 30 lines = %d lines, %v; want the first %d", len(got.Text), err, MaxAnchorLines)
	}

	wide := strings.Repeat("x", 1500)
	lines = Lines{1, 3}
	got, err = Capture(Side{Exists: true, Content: []byte(wide + "\n" + wide + "\n" + wide)}, &lines)
	if err != nil || len(got.Text) != 1 {
		t.Errorf("Capture of 4.5 KiB = %d lines, %v; want 1 within %d bytes", len(got.Text), err, MaxAnchorBytes)
	}

	long := strings.Repeat("é", MaxAnchorBytes)
	lines = Lines{1, 1}
	got, err = Capture(Side{Exists: true, Content: []byte(long)}, &lines)
	if err != nil || len(got.Text) != 1 || len(got.Text[0]) > MaxAnchorBytes || !strings.HasPrefix(long, got.Text[0]) {
		t.Fatalf("Capture of a long line = %d bytes, %v; want a cut prefix", len(got.Text[0]), err)
	}
	if location := Resolve(Anchor{Lines: &lines, Text: got.Text}, Side{Exists: true, Content: []byte("new first line\n" + long)}); location.State != StateMoved || *location.Lines != (Lines{2, 2}) {
		t.Errorf("a cut line resolves to %+v, want moved to 2", location)
	}
}

func TestCaptureRejectsWhatLinesCannotAnchor(t *testing.T) {
	lines := Lines{2, 4}
	if _, err := Capture(Side{Exists: true, Content: []byte("a\nb\n")}, &lines); err == nil || err.Error() != "end 4 is past the file's last line, 2" {
		t.Errorf("past the end = %v", err)
	}
	if _, err := Capture(Side{Exists: true, Content: []byte("a\x00b\nc\nd\ne\n")}, &lines); err != ErrBinary {
		t.Errorf("binary = %v, want ErrBinary", err)
	}
	if _, err := Capture(Side{Exists: true, TooLarge: true}, &lines); err != ErrTooLarge {
		t.Errorf("too large = %v, want ErrTooLarge", err)
	}
	if got, err := Capture(Side{Exists: true, Content: []byte("\x00")}, nil); err != nil || got.Blob != BlobHash([]byte("\x00")) || got.Text != nil {
		t.Errorf("file-level binary = %+v, %v; want only the blob", got, err)
	}
	if got, err := Capture(Side{Exists: true, TooLarge: true}, nil); err != nil || !reflect.DeepEqual(got, Snapshot{}) {
		t.Errorf("file-level too large = %+v, %v; want nothing", got, err)
	}
}

func TestResolve(t *testing.T) {
	original := "package main\n\nfunc main() {\n\tgreet()\n}\n"
	anchorAt := func(content string, start, end int) Anchor {
		lines := Lines{start, end}
		snapshot, err := Capture(Side{Exists: true, Content: []byte(content)}, &lines)
		if err != nil {
			t.Fatal(err)
		}
		return Anchor{Path: "main.go", Side: SideNew, Lines: &lines, Text: snapshot.Text, Before: snapshot.Before, After: snapshot.After, Blob: snapshot.Blob}
	}
	at := func(start, end int) *Lines { return &Lines{start, end} }
	duplicates := "a\nx\nb\n\nc\nx\nd\n"
	tests := []struct {
		name    string
		anchor  Anchor
		side    Side
		state   string
		lines   *Lines
		comment string
	}{
		{"same blob", anchorAt(original, 4, 4), Side{Exists: true, Content: []byte(original)}, StateAnchored, at(4, 4), ""},
		{"edited elsewhere, same lines", anchorAt(original, 4, 4), Side{Exists: true, Content: []byte("package main\n\nfunc main() {\n\tgreet()\n}\n\n// end\n")}, StateAnchored, at(4, 4), ""},
		{"moved down", anchorAt(original, 3, 5), Side{Exists: true, Content: []byte("package main\n\nimport \"fmt\"\n\nfunc main() {\n\tgreet()\n}\n")}, StateMoved, at(5, 7), ""},
		{"trailing whitespace ignored", anchorAt(original, 4, 4), Side{Exists: true, Content: []byte("package main\n\n\nfunc main() {\n\tgreet()  \r\n}\n")}, StateMoved, at(5, 5), ""},
		{"indentation counts", anchorAt(original, 4, 4), Side{Exists: true, Content: []byte("package main\n\nfunc main() {\n    greet()\n}\n")}, StateOutdated, nil, ""},
		{"deleted text", anchorAt(original, 4, 4), Side{Exists: true, Content: []byte("package main\n\nfunc main() {\n}\n")}, StateOutdated, nil, ""},
		{"missing file", anchorAt(original, 4, 4), Side{}, StateOutdated, nil, ""},
		{"binary now", anchorAt(original, 4, 4), Side{Exists: true, Content: []byte("\tgreet()\n\x00")}, StateOutdated, nil, ""},
		{"too large now", anchorAt(original, 4, 4), Side{Exists: true, TooLarge: true}, StateOutdated, nil, ""},
		{"file-level", Anchor{Path: "main.go", Side: SideNew}, Side{Exists: true, Content: []byte("anything")}, StateAnchored, nil, ""},
		{"file-level binary", Anchor{Path: "logo.png", Side: SideNew}, Side{Exists: true, Content: []byte("\x89PNG\x00")}, StateAnchored, nil, ""},
		{"file-level too large", Anchor{Path: "big.log", Side: SideNew}, Side{Exists: true, TooLarge: true}, StateAnchored, nil, ""},
		{"file-level missing", Anchor{Path: "main.go", Side: SideNew}, Side{}, StateOutdated, nil, ""},
		// x at 2 has context a/b; x at 6 has c/d. The anchor's context picks.
		{"duplicates: context wins over distance", anchorAt(duplicates, 6, 6), Side{Exists: true, Content: []byte("a\nx\nb\nc\nx\nd\n\n\n")}, StateMoved, at(5, 5), "the second x keeps c and d"},
		{"duplicates: context wins at the original lines", anchorAt(duplicates, 2, 2), Side{Exists: true, Content: []byte("c\nx\nd\na\nx\nb\n\n")}, StateMoved, at(5, 5), "a and b moved below"},
		{"duplicates: nearest on equal context", Anchor{Lines: at(4, 4), Text: []string{"x"}}, Side{Exists: true, Content: []byte("x\n-\n-\n-\n-\nx\n")}, StateMoved, at(6, 6), "6 is 2 away, 1 is 3"},
		{"duplicates: earlier on equal distance", Anchor{Lines: at(3, 3), Text: []string{"x"}}, Side{Exists: true, Content: []byte("-\nx\n-\nx\n")}, StateMoved, at(2, 2), "2 and 4 are both 1 away"},
		{"duplicates: anchored when one is at the lines", Anchor{Lines: at(2, 2), Text: []string{"x"}}, Side{Exists: true, Content: []byte("-\nx\n-\nx\n")}, StateAnchored, at(2, 2), ""},
		{"moved range keeps its length, cut at the end", Anchor{Lines: at(1, 3), Text: []string{"a", "b", "c"}}, Side{Exists: true, Content: []byte("-\n-\na\nb\n")}, StateOutdated, nil, "c is gone"},
		{"long range keeps its length", Anchor{Lines: at(1, 25), Text: []string{"a"}}, Side{Exists: true, Content: []byte("-\na\n" + strings.Repeat("z\n", 10))}, StateMoved, at(2, 12), "cut at the file's 12 lines"},
	}
	for _, test := range tests {
		got := Resolve(test.anchor, test.side)
		if got.State != test.state || !reflect.DeepEqual(got.Lines, test.lines) {
			t.Errorf("%s: Resolve = %s %v, want %s %v (%s)", test.name, got.State, got.Lines, test.state, test.lines, test.comment)
		}
	}
}
