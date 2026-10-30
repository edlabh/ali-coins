# Release Guide

> 🌐 **Languages:** [Português](RELEASING.md) | English

This document describes the `ali-coins` release process, including GitHub Releases
automation and the current **2.x** cycle. The Portuguese version is canonical; if they
diverge, [RELEASING.md](RELEASING.md) prevails.

## Versioning

- The project follows [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.
- Compatible changes go into `MINOR`; breaking changes require `MAJOR`.
- The public contract (CLI, exit codes `0–7`, `session*.json(.enc)` format,
  `v3:N:r:p:...` token, environment variables and `--json` reports) has been stable since
  **1.0.0**.

## Release flow (from 1.0.0; current 2.x cycle)

1. **Accumulate changes** on `main`, recording each item in the `## [Unreleased]` section
   of `CHANGELOG.md` (categories `Added`, `Fixed`, `Changed`, `Removed`, `Security`).
2. **Update the version** (without creating a tag yet):
   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```
3. **Close the CHANGELOG**: move the `[Unreleased]` content to
   `## [X.Y.Z] - YYYY-MM-DD` (keeping the `[Unreleased]` header empty for the next cycle).
4. **Validate locally** (including coverage and benchmark):
   ```bash
   npm ci
   npm run lint && npm run format:check
   npm run test:coverage
   npm audit --omit=dev
   npm run bench
   shellcheck -x $(find . -path ./node_modules -prune -o -name '*.sh' -print)
   ```
   In CI, ShellCheck, actionlint, PowerShell, CodeQL, Gitleaks and Docker are also gates.
5. **Local commit and tags** (the project keeps both tag forms pointing to the same
   commit). **Do not push** until the maintainer explicitly authorizes it:
   ```bash
   git add -A
   git commit -m "chore(release): X.Y.Z"
   git tag -a X.Y.Z -m "vX.Y.Z - <summary>"
   git tag -a vX.Y.Z -m "vX.Y.Z - <summary>"
   # Push only with maintainer authorization:
   # git push origin main
   # git push origin X.Y.Z vX.Y.Z
   ```
6. **Automation**: the [`Release`](../.github/workflows/release.yml) workflow triggers on
   `X.Y.Z`/`vX.Y.Z` tags, validates that the tag matches `package.json`, runs lint + tests
   and publishes (or idempotently updates) the GitHub Release:
   - Title: `Release X.Y.Z`
   - Notes: the matching `CHANGELOG.md` section; if absent, GitHub-generated notes
   - `--latest` for stable versions; `--prerelease` for versions with a suffix
     (`-rc.1`, `-beta.2`)

> If the workflow fails because the tag diverges from `package.json`, fix the version,
> recreate the tag and push again (`git push --force origin X.Y.Z vX.Y.Z`).

### Pre-release (RC)

To publish a pre-release, use a SemVer suffix and **never move an already published tag**
(the authorized exception is below):

```bash
npm version X.Y.Z-rc.1 --no-git-tag-version
# Set the CHANGELOG heading to ## [X.Y.Z-rc.1] - YYYY-MM-DD
git add package.json package-lock.json docs/CHANGELOG.md docs/CHANGELOG.en.md
git commit -m "chore(release): X.Y.Z-rc.1"
git tag -a X.Y.Z-rc.1 -m "vX.Y.Z-rc.1 - release candidate"
git tag -a vX.Y.Z-rc.1 -m "vX.Y.Z-rc.1 - release candidate"
```

The `Release` workflow creates the GitHub Release with `--prerelease`. After validation,
repeat the flow with the stable `X.Y.Z` version; do not reuse/move the RC tag outside the
exception below.

### Authorized RC re-release

Exceptionally, the maintainer may authorize re-releasing an RC to include fixes already
validated on `main`, without creating a new version. In that case, preserve ancestry,
recreate both tags at the current commit and use `--force-with-lease`:

```bash
git merge-base --is-ancestor <old-commit> HEAD

git tag -f -a X.Y.Z-rc.N -m "vX.Y.Z-rc.N - <summary>" HEAD
git tag -f -a vX.Y.Z-rc.N -m "vX.Y.Z-rc.N - <summary>" HEAD
git push origin \
  --force-with-lease=refs/tags/X.Y.Z-rc.N:<old-object> \
  --force-with-lease=refs/tags/vX.Y.Z-rc.N:<old-object> \
  X.Y.Z-rc.N vX.Y.Z-rc.N
```

The `Release` workflow updates the existing release idempotently. Never use this
exception for stable tags.

## Manual release (fallback)

```bash
curl -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/releases \
  -d '{"tag_name":"X.Y.Z","name":"Release X.Y.Z","body":"<notes>","make_latest":"true"}'
```

## Release checklist (2.x)

- [ ] `[Unreleased]` migrated to `## [X.Y.Z] - <date>` with a **migration guide** for any
      contract breaks.
- [ ] CLI and exit codes `0–7` documented and covered by tests.
- [ ] Token (`v1`/`v2`/`v3`) and `session*.json(.enc)` compatibility validated.
- [ ] No open high/medium severity findings in the latest audit.
- [ ] CI green on all 3 systems (Ubuntu, Windows, macOS) + CodeQL + Gitleaks + Docker.
- [ ] Coverage ≥ 80% (`npm run test:coverage`) and benchmark (`npm run bench`) recorded.
- [ ] `npm audit --omit=dev` without vulnerabilities.
- [ ] `RELEASING`, `README`, `CHANGELOG`, `OBSERVABILITY`, `PERFORMANCE` and
      `credentials.env.example` in sync in **PT-BR/EN** (no Spanish documentation).
- [ ] Script interface text supports only **PT-BR/EN** (`APP_LANGUAGE`/`--lang`).
- [ ] Tags `X.Y.Z`/`vX.Y.Z` (or `X.Y.Z-rc.N`/`vX.Y.Z-rc.N`) pointing to the release
      commit; push only with authorization. Published tags are not moved, except for the
      authorized RC re-release above.
