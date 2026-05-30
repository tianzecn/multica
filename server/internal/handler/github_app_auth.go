package handler

import (
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var errGitHubAppAuthNotConfigured = errors.New("github app authentication is not configured")

type GitHubInstallationTokenSource interface {
	Configured() bool
	InstallationToken(ctx context.Context, installationID int64) (string, error)
}

type envGitHubInstallationTokenSource struct {
	client        *http.Client
	apiBaseURL    string
	appID         string
	privateKeyPEM []byte
	loadErr       error
	configured    bool
	now           func() time.Time
}

func NewEnvGitHubInstallationTokenSource() GitHubInstallationTokenSource {
	privateKeyPEM, keyConfigured, loadErr := githubAppPrivateKeyPEM()
	return &envGitHubInstallationTokenSource{
		client:        &http.Client{Timeout: 30 * time.Second},
		apiBaseURL:    githubAPIBaseURL(),
		appID:         strings.TrimSpace(os.Getenv("GITHUB_APP_ID")),
		privateKeyPEM: privateKeyPEM,
		loadErr:       loadErr,
		configured:    strings.TrimSpace(os.Getenv("GITHUB_APP_ID")) != "" && keyConfigured,
		now:           time.Now,
	}
}

func (s *envGitHubInstallationTokenSource) Configured() bool {
	return s != nil && s.configured
}

func (s *envGitHubInstallationTokenSource) InstallationToken(ctx context.Context, installationID int64) (string, error) {
	if s == nil || !s.configured {
		return "", errGitHubAppAuthNotConfigured
	}
	if installationID <= 0 {
		return "", errors.New("github installation id is required")
	}
	if s.loadErr != nil {
		return "", fmt.Errorf("load github app private key: %w", s.loadErr)
	}
	appID := strings.TrimSpace(s.appID)
	if appID == "" || len(s.privateKeyPEM) == 0 {
		return "", errGitHubAppAuthNotConfigured
	}
	if _, err := strconv.ParseInt(appID, 10, 64); err != nil {
		return "", errors.New("GITHUB_APP_ID must be numeric")
	}
	key, err := parseGitHubAppPrivateKey(s.privateKeyPEM)
	if err != nil {
		return "", err
	}
	now := s.now().UTC()
	claims := jwt.RegisteredClaims{
		Issuer:    appID,
		IssuedAt:  jwt.NewNumericDate(now.Add(-1 * time.Minute)),
		ExpiresAt: jwt.NewNumericDate(now.Add(9 * time.Minute)),
	}
	appJWT, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
	if err != nil {
		return "", err
	}
	endpoint := fmt.Sprintf("%s/app/installations/%d/access_tokens", s.apiBaseURL, installationID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(nil))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+appJWT)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		if msg == "" {
			msg = resp.Status
		}
		return "", fmt.Errorf("github installation token request failed: %s", msg)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("decode github installation token response: %w", err)
	}
	if strings.TrimSpace(out.Token) == "" {
		return "", errors.New("github installation token response was missing token")
	}
	return out.Token, nil
}

func githubFallbackToken(primaryEnv string) string {
	token := strings.TrimSpace(os.Getenv(primaryEnv))
	if token == "" {
		token = strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
	}
	return token
}

func githubAPIBaseURL() string {
	apiBaseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("GITHUB_API_BASE_URL")), "/")
	if apiBaseURL == "" {
		apiBaseURL = "https://api.github.com"
	}
	return apiBaseURL
}

func githubGraphQLURL() string {
	graphQLURL := strings.TrimSpace(os.Getenv("GITHUB_GRAPHQL_URL"))
	if graphQLURL == "" {
		graphQLURL = "https://api.github.com/graphql"
	}
	return graphQLURL
}

func resolveGitHubAuthToken(ctx context.Context, source GitHubInstallationTokenSource, fallbackToken string, installationID int64) (string, error) {
	if installationID > 0 && source != nil && source.Configured() {
		return source.InstallationToken(ctx, installationID)
	}
	if strings.TrimSpace(fallbackToken) != "" {
		return strings.TrimSpace(fallbackToken), nil
	}
	return "", errGitHubAppAuthNotConfigured
}

func githubAppPrivateKeyPEM() ([]byte, bool, error) {
	if raw := strings.TrimSpace(os.Getenv("GITHUB_APP_PRIVATE_KEY")); raw != "" {
		return []byte(strings.ReplaceAll(raw, `\n`, "\n")), true, nil
	}
	if raw := strings.TrimSpace(os.Getenv("GITHUB_APP_PRIVATE_KEY_B64")); raw != "" {
		decoded, err := base64.StdEncoding.DecodeString(raw)
		return decoded, true, err
	}
	if path := strings.TrimSpace(os.Getenv("GITHUB_APP_PRIVATE_KEY_PATH")); path != "" {
		content, err := os.ReadFile(path)
		return content, true, err
	}
	return nil, false, nil
}

func parseGitHubAppPrivateKey(pemBytes []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("github app private key must be PEM encoded")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse github app private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("github app private key must be an RSA private key")
	}
	return key, nil
}
