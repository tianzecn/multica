//go:build darwin || linux || freebsd || openbsd || netbsd

package daemon

import (
	"os/exec"
	"syscall"
)

func configureProjectScriptCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateProjectScriptProcess(pid int) {
	if pid <= 0 {
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGTERM)
}
