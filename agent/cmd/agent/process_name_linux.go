//go:build linux

package main

import (
	"os"
	"strings"
)

// setProcessName changes the Linux comm label only. It does not alter the
// command line, install persistence, or impersonate an existing system daemon.
func setProcessName(name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	if len(name) > 15 {
		name = name[:15]
	}
	_ = os.WriteFile("/proc/self/comm", []byte(name), 0o600)
}
