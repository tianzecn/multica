-- Local client feature queries kept separate from the upstream query set.
-- sqlc loads every .sql file in this directory.

-- name: GetGitHubInstallationByInstallationID :one
SELECT * FROM github_installation
WHERE installation_id = $1;

-- name: ListPullRequestsByProject :many
-- Returns PRs linked directly to the project or to any issue in the project,
-- with the same current-head check aggregation used by the issue sidebar.
-- DISTINCT ON keeps a PR that is linked through multiple paths from rendering
-- more than once.
WITH project_prs AS (
    SELECT DISTINCT pr.id, pr.head_sha, pr.snapshot_head_sha
    FROM github_pull_request pr
    JOIN (
        SELECT ppr.pull_request_id
        FROM project_pull_request ppr
        WHERE ppr.project_id = sqlc.arg('project_id')
        UNION
        SELECT ipr.pull_request_id
        FROM issue_pull_request ipr
        JOIN issue i ON i.id = ipr.issue_id
        WHERE i.project_id = sqlc.arg('project_id')
          AND NOT ipr.reference_only
    ) links ON links.pull_request_id = pr.id
),
checks AS (
    SELECT
        cr.pr_id,
        COUNT(*)::bigint AS total,
        SUM(CASE WHEN cr.status = 'completed' AND cr.conclusion IN
                ('failure','cancelled','timed_out','action_required','startup_failure','stale','error')
            THEN 1 ELSE 0 END)::bigint AS failed,
        SUM(CASE WHEN cr.status = 'completed' AND cr.conclusion IN
                ('success','neutral','skipped')
            THEN 1 ELSE 0 END)::bigint AS passed,
        SUM(CASE WHEN cr.status <> 'completed' OR cr.conclusion IS NULL
            THEN 1 ELSE 0 END)::bigint AS running,
        COALESCE(
            array_agg(cr.name) FILTER (WHERE cr.status = 'completed' AND cr.conclusion IN
                ('failure','cancelled','timed_out','action_required','startup_failure','stale','error')),
            '{}'
        )::text[] AS failed_names
    FROM github_pull_request_check_run cr
    JOIN project_prs pp ON pp.id = cr.pr_id
    WHERE cr.head_sha = pp.snapshot_head_sha AND pp.snapshot_head_sha <> ''
    GROUP BY cr.pr_id
)
SELECT
    pr.id, pr.workspace_id, pr.installation_id, pr.repo_owner, pr.repo_name,
    pr.pr_number, pr.title, pr.state, pr.html_url, pr.branch, pr.author_login,
    pr.author_avatar_url, pr.merged_at, pr.closed_at, pr.pr_created_at,
    pr.pr_updated_at, pr.head_sha, pr.mergeable_state,
    pr.additions, pr.deletions, pr.changed_files,
    pr.api_mergeable, pr.api_merge_state_status, pr.checks_rollup_state,
    pr.snapshot_head_sha, pr.snapshot_fetched_at,
    pr.created_at, pr.updated_at,
    COALESCE(c.total, 0)::bigint   AS checks_total,
    COALESCE(c.passed, 0)::bigint  AS checks_passed,
    COALESCE(c.failed, 0)::bigint  AS checks_failed,
    COALESCE(c.running, 0)::bigint AS checks_running,
    COALESCE(c.failed_names, '{}')::text[] AS failed_check_names
FROM github_pull_request pr
JOIN project_prs pp ON pp.id = pr.id
LEFT JOIN checks c ON c.pr_id = pr.id
ORDER BY pr.pr_created_at DESC;

-- name: GetSiblingPullRequestStateCountsForIssue :one
-- Returns, for the PRs linked to an issue excluding one PR by id (the PR
-- currently being processed by the webhook handler), how many are still in
-- flight (open or draft) and how many have already merged. The webhook
-- handler combines these with the current event's state to decide whether
-- to auto-advance the issue: the issue moves to done only when there is no
-- in-flight sibling AND at least one linked PR (current or sibling) merged.
SELECT
    COALESCE(SUM(CASE WHEN pr.state IN ('open', 'draft') THEN 1 ELSE 0 END), 0)::bigint AS open_count,
    COALESCE(SUM(CASE WHEN pr.state = 'merged' THEN 1 ELSE 0 END), 0)::bigint AS merged_count
FROM github_pull_request pr
JOIN issue_pull_request ipr ON ipr.pull_request_id = pr.id
WHERE ipr.issue_id = $1
  AND pr.id <> $2;

-- =====================
-- GitHub PR check suite
-- =====================

-- name: UpsertPullRequestCheckSuite :exec
-- Upserts a single check_suite row keyed by (pr_id, suite_id). The WHERE
-- clause on the DO UPDATE branch prevents a late-arriving older event from
-- overwriting a newer one — same-PR/same-suite ordering protection. Late
-- events targeting an old head still land here (their head_sha is stored
-- on the row); the head_sha filter in ListPullRequestsByIssue keeps them
-- out of the current aggregate.
INSERT INTO github_pull_request_check_suite (
    pr_id, suite_id, head_sha, app_id, conclusion, status, updated_at
) VALUES (
    $1, $2, $3, $4, sqlc.narg('conclusion'), $5, $6
)
ON CONFLICT (pr_id, suite_id) DO UPDATE SET
    head_sha   = EXCLUDED.head_sha,
    app_id     = EXCLUDED.app_id,
    conclusion = EXCLUDED.conclusion,
    status     = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at
WHERE EXCLUDED.updated_at >= github_pull_request_check_suite.updated_at;

-- =====================
-- Issue ↔ Pull Request link
-- =====================
