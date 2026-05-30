package handler

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type staticGitHubInstallationTokenSource struct {
	configured     bool
	token          string
	installationID int64
}

func (s *staticGitHubInstallationTokenSource) Configured() bool {
	return s.configured
}

func (s *staticGitHubInstallationTokenSource) InstallationToken(_ context.Context, installationID int64) (string, error) {
	s.installationID = installationID
	return s.token, nil
}

func TestEnvGitHubInstallationTokenSourceMintsAppJWT(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	now := func() time.Time { return time.Date(2026, 5, 28, 12, 0, 0, 0, time.UTC) }
	var sawJWT bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/app/installations/123/access_tokens" {
			t.Fatalf("unexpected token request: %s %s", r.Method, r.URL.Path)
		}
		tokenString := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &jwt.RegisteredClaims{}
		parser := jwt.NewParser(jwt.WithTimeFunc(now))
		parsed, err := parser.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
			if token.Method.Alg() != jwt.SigningMethodRS256.Alg() {
				t.Fatalf("unexpected signing method: %s", token.Method.Alg())
			}
			return &key.PublicKey, nil
		})
		if err != nil || !parsed.Valid {
			t.Fatalf("parse app jwt: token=%v err=%v", parsed, err)
		}
		if claims.Issuer != "12345" {
			t.Fatalf("issuer = %q, want app id", claims.Issuer)
		}
		sawJWT = true
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "installation-token"})
	}))
	defer server.Close()

	source := &envGitHubInstallationTokenSource{
		client:        server.Client(),
		apiBaseURL:    server.URL,
		appID:         "12345",
		privateKeyPEM: privateKeyPEM,
		configured:    true,
		now:           now,
	}
	token, err := source.InstallationToken(context.Background(), 123)
	if err != nil {
		t.Fatalf("InstallationToken: %v", err)
	}
	if token != "installation-token" || !sawJWT {
		t.Fatalf("token=%q sawJWT=%v", token, sawJWT)
	}
}

func TestEnvGitHubRepoCreatorPrefersInstallationToken(t *testing.T) {
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/orgs/acme/repos" {
			t.Fatalf("unexpected repo create request: %s %s", r.Method, r.URL.Path)
		}
		authHeader = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"name":           "widget",
			"full_name":      "acme/widget",
			"html_url":       "https://github.com/acme/widget",
			"clone_url":      "https://github.com/acme/widget.git",
			"ssh_url":        "git@github.com:acme/widget.git",
			"default_branch": "main",
			"visibility":     "private",
			"private":        true,
			"owner": map[string]string{
				"login": "acme",
			},
		})
	}))
	defer server.Close()

	tokenSource := &staticGitHubInstallationTokenSource{configured: true, token: "installation-token"}
	creator := &envGitHubRepoCreator{
		client:      server.Client(),
		token:       "fallback-token",
		apiBaseURL:  server.URL,
		tokenSource: tokenSource,
	}
	repo, err := creator.CreateRepository(context.Background(), CreateGitHubRepositoryInput{
		InstallationID: 77,
		Owner:          "acme",
		OwnerType:      "organization",
		Name:           "widget",
		Visibility:     "private",
	})
	if err != nil {
		t.Fatalf("CreateRepository: %v", err)
	}
	if repo.CloneURL != "https://github.com/acme/widget.git" {
		t.Fatalf("clone_url = %q", repo.CloneURL)
	}
	if tokenSource.installationID != 77 {
		t.Fatalf("installation id = %d, want 77", tokenSource.installationID)
	}
	if authHeader != "Bearer installation-token" {
		t.Fatalf("Authorization = %q, want installation token", authHeader)
	}
}
