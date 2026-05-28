package agent

import "time"

// The fake CLI fixtures usually finish in milliseconds, but `go test ./...`
// runs package test binaries concurrently. Leave enough headroom for loaded
// machines so tests fail on behavior, not scheduler pressure.
const (
	fakeAgentContextTimeout = 30 * time.Second
	fakeAgentExecTimeout    = 15 * time.Second
	fakeAgentResultTimeout  = 30 * time.Second
)
