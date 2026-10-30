# Pre-release Review — 2.5.0

Read-only review performed on 2026-10-30, before the local commit/tags. Canonical version:
[RELEASE_REVIEW_2.5.0.md](RELEASE_REVIEW_2.5.0.md) (PT-BR).

## Scope

- Base: tag `2.4.0` (`84c51a7e17144f9ca2a31a23f19cdbd2903ae913`)
- Reviewed head: `d0ea829554373d184e2c1f16938d83d4dec25047`
- Changes: 2.5.0 hardening fronts in code/tests/docs (details in `CHANGELOG.md`); the
  release commit and tags `2.5.0`/`v2.5.0` are created after this review.
- Worktree: only `CHANGELOG.md`, `RELEASING.md`, `package.json` and `package-lock.json`
  from the release itself; they are included in `chore(release): 2.5.0`.

## Conclusion

**NO_BLOCKER_FOUND** for a local release. There is no database migration, infrastructure
change or new secret. Remote publication remains out of scope and requires authorization.

## Verification

| Area         | Evidence                                                                          |
| ------------ | --------------------------------------------------------------------------------- |
| Version      | `package.json` and `package-lock.json` root at `2.5.0`; `npm ci --dry-run` OK     |
| Changelog    | `## [2.5.0] - 2026-10-30` section; `[Unreleased]` empty                           |
| Tests        | `npm test`: 561/561                                                               |
| Coverage     | `npm run test:coverage`: 88.03% lines (80% threshold)                             |
| Lint/format  | ESLint and Prettier green                                                         |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities                                         |
| Scripts      | ShellCheck OK; actionlint 1.7.12 OK; workflow YAML valid                          |
| Secrets      | no tracked `credentials.env`, session, token or key                               |
| Contract     | exit codes `0–7`, `v1/v2/v3` tokens, session format and existing fields preserved |

## Confirmation items (P2)

- Remote CI (Ubuntu/Windows/macOS matrix, Docker, CodeQL, Gitleaks) has not run because the
  work remains local. Equivalent validations available on this host passed; the real matrix
  runs only after an authorized push.
- `pwsh` is not installed on this host; PowerShell syntax validation will run on the
  `windows-latest` runner.

## Rollback

1. Before push: `git reset --hard d0ea829` (or revert the release commit) and remove the
   local `2.5.0`/`v2.5.0` tags.
2. After an authorized push: revert the release commit and recreate tags only with the
   maintainer's authorization; never move published tags without alignment.
3. There is no data migration; rollback is code/artifact only.

## Deployment order

Not applicable to multiple services. This is a daily CLI/cron; update by replacing the
checkout and running `npm ci`, keeping `credentials.env` and local sessions outside the
repository.
