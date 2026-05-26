DROP INDEX IF EXISTS idx_project_resource_primary_github_repo;
DROP INDEX IF EXISTS idx_project_resource_github_repo_url;

UPDATE project_resource
SET resource_ref = resource_ref - 'role'
WHERE resource_type = 'github_repo';
