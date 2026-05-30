package main

import (
	"slices"
	"testing"
)

func TestAllowedOriginsUsesDefaultsWhenUnset(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	t.Setenv("FRONTEND_ORIGIN", "")
	t.Setenv("APP_ENV", "")

	got := allowedOrigins()

	assertOriginsEqual(t, got, defaultOrigins)
}

func TestAllowedOriginsKeepsElectronDevOriginsWithFrontendOrigin(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	t.Setenv("FRONTEND_ORIGIN", "http://localhost:3000")
	t.Setenv("APP_ENV", "")

	got := allowedOrigins()

	assertContainsOrigin(t, got, "http://localhost:3000")
	assertContainsOrigin(t, got, "http://localhost:5173")
	assertContainsOrigin(t, got, "http://localhost:5174")
	assertNoDuplicateOrigins(t, got)
}

func TestAllowedOriginsHonorsExplicitCorsOrigins(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
	t.Setenv("FRONTEND_ORIGIN", "http://localhost:3000")
	t.Setenv("APP_ENV", "")

	got := allowedOrigins()

	assertOriginsEqual(t, got, []string{"https://app.example.com"})
}

func TestAllowedOriginsDoesNotAppendDevOriginsInProduction(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	t.Setenv("FRONTEND_ORIGIN", "https://app.example.com")
	t.Setenv("APP_ENV", "production")

	got := allowedOrigins()

	assertOriginsEqual(t, got, []string{"https://app.example.com"})
}

func assertOriginsEqual(t *testing.T, got []string, want []string) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Fatalf("allowedOrigins() = %#v, want %#v", got, want)
	}
}

func assertContainsOrigin(t *testing.T, origins []string, want string) {
	t.Helper()
	if !slices.Contains(origins, want) {
		t.Fatalf("allowedOrigins() = %#v, want origin %q", origins, want)
	}
}

func assertNoDuplicateOrigins(t *testing.T, origins []string) {
	t.Helper()
	seen := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		if _, ok := seen[origin]; ok {
			t.Fatalf("allowedOrigins() contains duplicate origin %q: %#v", origin, origins)
		}
		seen[origin] = struct{}{}
	}
}
