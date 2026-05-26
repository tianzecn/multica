# Project Repositories

## Product model

Workspace repositories are the team's available codebase pool. A project narrows
that pool into one main repository plus optional related repositories.

- Main repository: the default checkout target for project tasks.
- Related repositories: reference context for cross-repo awareness.
- Workspace repositories: fallback only when a project has no main repository.

When a user says "this project", agents should treat the main repository as the
project's codebase. Related repositories should not be treated as equal checkout
targets unless the user explicitly asks for cross-repo context.

## Data model

Project repositories continue to use `project_resource` with
`resource_type = 'github_repo'`. The `resource_ref` JSON carries the role:

```json
{
  "url": "https://github.com/acme/web",
  "role": "primary"
}
```

Related repositories use the same resource type:

```json
{
  "url": "https://github.com/acme/api",
  "role": "related"
}
```

The database enforces one primary GitHub repository per project and one row per
repository URL per project.

## Agent execution

Daemon claim responses put only the project's primary repository in `repos`.
All project resources, including related repositories, remain available in
`project_resources` so agents can inspect context without confusing the default
worktree target.
