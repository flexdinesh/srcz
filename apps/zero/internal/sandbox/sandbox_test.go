package sandbox

import (
	"strings"
	"testing"

	"github.com/flexdinesh/zero/internal/sandbox/docker"
)

func TestParseTarget(t *testing.T) {
	container := func(name string) docker.Container { return docker.Container{Name: name, Dir: InstallDir} }
	tests := []struct {
		text string
		want Target
	}{
		{"docker://web", Target{Environment: container("web"), Path: "."}},
		{"docker://web/", Target{Environment: container("web"), Path: "/"}},
		{"docker://web/src", Target{Environment: container("web"), Path: "/src"}},
		{"docker://my_app.web-1/srv/app/", Target{Environment: container("my_app.web-1"), Path: "/srv/app"}},
		{"docker://3f2a9c1b7d4e/a/../b", Target{Environment: container("3f2a9c1b7d4e"), Path: "/b"}},
		{"docker://web/a dir/x", Target{Environment: container("web"), Path: "/a dir/x"}},
	}
	for _, test := range tests {
		got, err := ParseTarget(test.text)
		if err != nil {
			t.Errorf("ParseTarget(%q) = %v", test.text, err)
			continue
		}
		if got != test.want {
			t.Errorf("ParseTarget(%q) = %+v, want %+v", test.text, got, test.want)
		}
	}
}

func TestParseTargetRejects(t *testing.T) {
	tests := []struct{ text, says string }{
		{"web", "docker://<container>"},
		{"/src", "docker://<container>"},
		{"docker:web", "docker://<container>"},
		{"docker://", "name a container"},
		{"docker:///src", "name a container"},
		{"docker://-rm/src", "not a Docker container name"},
		{"docker://a:b/src", "not a Docker container name"},
		{"podman://web", "cannot attach to podman://"},
		{"://web", "cannot attach to ://"},
	}
	for _, test := range tests {
		_, err := ParseTarget(test.text)
		if err == nil || !strings.Contains(err.Error(), test.says) {
			t.Errorf("ParseTarget(%q) = %v, want an error saying %q", test.text, err, test.says)
		}
	}
}
