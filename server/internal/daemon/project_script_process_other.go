//go:build !darwin && !linux && !freebsd && !openbsd && !netbsd

package daemon

import "os/exec"

func configureProjectScriptCommand(_ *exec.Cmd) {}

func terminateProjectScriptProcess(_ int) {}
