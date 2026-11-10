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
		{"docker://web", Target{Environment: container("web"), Provider: "docker", Ref: "web", Path: "."}},
		{"docker://web/", Target{Environment: container("web"), Provider: "docker", Ref: "web", Path: "/"}},
		{"docker://web/src", Target{Environment: container("web"), Provider: "docker", Ref: "web", Path: "/src"}},
		{"docker://my_app.web-1/srv/app/", Target{Environment: container("my_app.web-1"), Provider: "docker", Ref: "my_app.web-1", Path: "/srv/app"}},
		{"docker://3f2a9c1b7d4e/a/../b", Target{Environment: container("3f2a9c1b7d4e"), Provider: "docker", Ref: "3f2a9c1b7d4e", Path: "/b"}},
		{"docker://web/a dir/x", Target{Environment: container("web"), Provider: "docker", Ref: "web", Path: "/a dir/x"}},
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

func TestTargetStringParsesBack(t *testing.T) {
	for _, text := range []string{"docker://web", "docker://web/", "docker://web/src", "docker://web/a/../b"} {
		target, err := ParseTarget(text)
		if err != nil {
			t.Fatal(err)
		}
		again, err := ParseTarget(target.String())
		if err != nil || again != target {
			t.Errorf("ParseTarget(%q.String() = %q) = %+v, %v, want %+v", text, target.String(), again, err, target)
		}
	}
}

func TestOpenNamesTheSameSandboxAsParseTarget(t *testing.T) {
	opened, err := Open("docker", "3f2a9c1b7d4e")
	if err != nil || opened != (docker.Container{Name: "3f2a9c1b7d4e", Dir: InstallDir}) {
		t.Fatalf("Open = %+v, %v", opened, err)
	}
	for _, test := range []struct{ provider, ref, says string }{
		{"podman", "web", "cannot attach to podman://"},
		{"docker", "", "name a container"},
		{"docker", "a/b", "not a Docker container name"},
	} {
		if _, err := Open(test.provider, test.ref); err == nil || !strings.Contains(err.Error(), test.says) {
			t.Errorf("Open(%q, %q) = %v, want an error saying %q", test.provider, test.ref, err, test.says)
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
