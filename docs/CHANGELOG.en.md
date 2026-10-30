# Changelog

> 🌐 **Languages:** [Português](CHANGELOG.md) | English

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

The Portuguese file ([CHANGELOG.md](CHANGELOG.md)) is the canonical historical archive.
This English file mirrors the full history; if the two diverge, the Portuguese version
prevails.

## [Unreleased]

> Changes for upcoming versions should be recorded here and moved to
> `## [X.Y.Z] - YYYY-MM-DD` at release time. See [RELEASING.en.md](RELEASING.en.md).

### Changed

- **Root layout:** manuals moved to `docs/`, internal modules to `libs/core/`, and helper
  scripts to `scripts/`. The root keeps only CLI entrypoints, execution wrappers,
  configuration, Docker and local state. CLI, exit codes, session format and default
  execution paths are unchanged.

## [2.5.0-rc.1] - 2026-10-30

Release candidate for 2.5.0. Structural hardening, observability and reliability release. It preserves the 2.4.0 public
contract (CLI, exit codes `0–7`, session/token format and existing report fields); report
changes are additive.

### Added

- **Deterministic Playwright integration harness:** fake pages/contexts/browsers, login
  gate/calendar/search fixtures, controllable clock and call collection. Covers valid
  session → check-in → report, expired session → DOM gate, `--check-session`, allowed/closed
  search popup and external/HTTP popup rejection, without real Chromium.
- **Stable i18n IDs:** `id → { pt, en }` catalog, deterministic legacy IDs, logger
  `msgId`/`msgParams` and legacy-usage telemetry. Initial migration of session-check,
  login, streak and import messages.
- **Per-run observability:** `run_metrics` event with `runId`, masked account, duration,
  check-in/tasks outcome, streak before/after, longest streak, coins, login attempt,
  captcha and context reuse. `runId`/account are also injected into log lines. Includes
  `OBSERVABILITY.en.md` with SLIs/SLOs, alerts and playbooks.
- **Performance benchmark:** `npm run bench` measures boot, memory and scrypt in separate
  processes; `PERFORMANCE.en.md` documents the baseline, 256 MB/768 MB budget and
  context/key decisions.
- **CI gates:** ShellCheck, actionlint (digest-pinned image), Windows PowerShell syntax
  validation, blocking SBOM and short-retention failure artifacts.
- **`--check-session` warnings:** exposes `warnings` when the `expiresAt` estimate has
  passed, without invalidating still-valid cookies.
- **Check-in metrics signals:** `loginAttempted` and `reusedEarlyDesktop` in the check-in
  result.

### Changed

- **`collect.js`/`all.js` modularization:** login/streak/result decisions moved to
  `libs/checkin/`; single-account and multi-account flows to `libs/runner/`. `collect.js`
  and `all.js` remain thin adapters with the same exports, exit codes and CLI behavior.
- **No Playwright on CLI paths:** `all.js --help`, `collect.js --help`, `--dry-run` and
  `--check-session` no longer load the browser. Local measurement: ~260 ms/149 MB →
  ~135 ms/80 MB (~48% less time and RSS).
- **Correlated reports and logs:** migrated messages use IDs; run logs carry `runId` and
  the masked account.
- **Release workflow:** tag verification now repeats lint, Prettier, coverage and audit.

### Fixed

- **Estimated expiry confused with invalid session:** `expiresAt` is now only a warning;
  real validity remains cookie-based.
- **Token hygiene regression coverage:** `--from-file` success removes the token, failure
  preserves it, `--keep-tokens` preserves it, STDIN never removes a file, and a partial
  batch keeps only the token that failed.
- **Plaintext session permissions:** `session.json` and `session_meta.json` are also
  verified as `0o600` when encryption is explicitly disabled.

### Security

- Token/session matrix covered by tests; no secrets in fixtures, snapshots or CI
  artifacts.
- `npm audit --omit=dev` without vulnerabilities; Gitleaks, CodeQL, Docker smoke and
  dependency audit remain CI gates.
- Cookie/token/query-string redaction, key rotation and legacy migration remain covered by
  the existing suites.

### Performance

- `all.js`/`collect.js` boot without Playwright: ~117 ms/78 MB on a cold `require`
  (previously ~173 ms/146 MB).
- scrypt: `N=131072` ~174 ms encrypt / ~169 ms decrypt (~197 MB peak); on a
  ≤1.5 GB/cgroup host the automatic adjustment uses `N=32768` (~45 ms / ~42 ms, ~100 MB
  peak).
- Desktop context reuse remains opt-in (`DESKTOP_REUSE_CONTEXT=true`); the mobile → tasks
  handoff avoids reloading the SPA.

### Documentation

- `README` and `CLOUD_SESSIONS` maintained in PT-BR and EN with 2.5.0 news and the
  `expiresAt` versus real-cookie decision.
- `OBSERVABILITY`, `PERFORMANCE` and `RELEASE_REVIEW_2.5.0` available in PT-BR/EN; the
  PT-BR version remains canonical if they diverge.
- `CHANGELOG.en.md`, `RELEASING.en.md` and `TELEGRAM.en.md` added with PT/EN navigation;
  the EN changelog mirrors the full history (2.5.0 through 0.7.0), keeping PT as the
  canonical source.

### Removed

- **Spanish documentation:** `*.es.md` files removed. Documentation and script interface
  messages now have only **PT-BR (default)** and **EN**.

### Tests

- 561 tests in the full suite; line coverage 88% (80% threshold).
- New suites: integration harness, check-in/runner modules, i18n IDs, observability
  metrics, session/token security, performance budget and CI gates.
- ShellCheck on all `*.sh`, actionlint 1.7.12, Prettier, ESLint and audit green.

## [2.4.0] - 2026-10-29

### Added

- **`--check-session` (read-only):** opens the coin center and reports whether the session
  is still authenticated, showing balance and streak without running check-in, tasks,
  notifications or heartbeat. In `all.js` it checks all accounts; in `collect.js` it
  respects `--account`. With `--json`, it emits `type: "session_check"` and
  `schemaVersion`. Exit code `0` when all sessions are valid and `1` when any fails.
- **`schemaVersion` in JSON contracts:** unified/multi-account reports
  (`REPORT_SCHEMA_VERSION = 1`), `session_check` and `session_meta.json`
  (`SESSION_META_SCHEMA_VERSION = 1`), enabling compatible evolution of webhooks,
  dashboards and external consumers.
- **`longestStreakSource` in `session_meta.json`:** records whether the record came from a
  trusted calendar read (`trusted`) or an estimate, allowing legacy records to be
  recalibrated without losing already-confirmed records.
- **`--allow-expired`:** explicit opt-out to import tokens whose estimated validity
  (`expiresAt`, ~90 days) has passed. The default still rejects expired tokens.
- **`resolveDailyCheckinCoins`:** prioritizes the amount actually credited in check-in
  (`coinsGainedToday`) and uses the streak tier only as a fallback estimate.

### Fixed

- **Coins/day shown in the report used only the streak tier:** an account that received
  `+1` could appear as `+40 coins/day` just because the streak was high. The real credited
  amount now takes priority; the tier is used only when the real amount is unavailable.
- **Streak break on trusted intermediate drops:** `isStreakBreak` now accepts
  `{ trustDetected: true }` and treats any real calendar reduction (e.g. `27 -> 6`) as a
  break, keeping protection against the weekly cycle when the read is untrusted. `all.js`
  propagates the signal from check-in.
- **Record inflated by an untrusted read:** `nextLongestStreak` recalibrates a legacy record
  only when a trusted read arrives and the previous record was never confirmed; `trusted`
  records never decrease.
- **Login gate detected only by text heuristics:** `isLoginGateVisible` now checks the DOM
  (visible login button + missing balance) and is consulted before deciding on re-login,
  reducing false positives and false negatives.
- **Embedded search popup accepted any host:** `isCoinSearchResultUrl` now requires HTTPS
  and an AliExpress host (`.aliexpress.com`), preventing an external popup that mimics
  `/coin-search/result.html` from receiving scroll/interaction.
- **Popup closing could hang the task:** `closePopupWithTimeout` limits `close()` to 3 s,
  avoiding a stuck execution with a frozen renderer.
- **Expired session tokens were imported silently:** `importSession` rejects tokens with
  `expiresAt` in the past (`ImportSessionError`), with opt-out via `--allow-expired`.
- **Single-use token remained on disk in `--from-file` mode:** the file is removed after a
  successful import (the batch flow already did this); `--keep-tokens` /
  `KEEP_SESSION_TOKENS=true` preserve it. STDIN is still not removed because it exposes no
  path.

### Documentation

- `README.md`, `README.en.md` and `README.es.md` (removed later in 2.5.0) document
  `--check-session`, `--allow-expired`, JSON output and token hygiene/validity.

### Tests

- `tests/reliability_240.test.js`: real coins/day value, trusted streak break, record
  recalibration, `schemaVersion`, search host/HTTPS validation, popup close timeout,
  `--check-session` classification, DOM login gate, expired-token rejection/opt-out and
  token cleanup with `--from-file`/`--keep-tokens`.
- Full suite (521 tests), lint and Prettier green.

## [2.3.0] - 2026-10-25

### Fixed

- **Local streak kept growing after AliExpress reset it:** any read `<= 7` with history
  `> 7` was treated as a spurious weekly cycle and replaced with `history + 1`. The
  current layout shows the real streak (calendar "Daily coins" with labels above "Day 7"),
  so a real break was never reflected. The calendar is now parsed
  (`parseCheckinCalendar`) and, when it is not a weekly cycle and TODAY matches the read
  number (`isRealStreakReading`), `resolveStreakDays({ trustDetected: true })` adopts the
  screen value even when lower than history. Without a calendar, previous behavior is
  kept. The parser ignores distant `Day N` labels and prefers the smallest container with
  "Today" plus at least three days.
- **Embedded coin-center search (aecoin-\* layout, Oct/2026):** when there is no `<input>`,
  the bot clicks `aecoin-searchNow-*`, captures the `coin-search/result.html` tab, scrolls
  the result and closes the tab, preserving the old path. The tab is accepted only if its
  URL is really the expected result page.
- **Main-tab renderer down/hung:** `ensureMainPage` tests page responsiveness with a 3 s
  `evaluate`; if the renderer is down (even with `isClosed()` false), it closes and
  recreates the page instead of exhausting retries in milliseconds.

### Added

- **Longest recorded streak (`longestStreakDays`):** stored in `session_meta.json` with
  `lastStreakDays`, shown in unified/isolated check-in logs ("Longest streak (record)"),
  Telegram messages ("Streak: 6 days (record: 23 days)" / "🏆 Longest streak") and report
  JSON. The record starts with the first run of this version and is never seeded from
  `lastStreakDays` (which could have inherited an inflated counter).

### Tests

- `tests/streak_real.test.js`: real calendars, reset, weekly cycle, parser with promotional
  noise, record in `session_meta.json`, check-in report and Telegram.
- `tests/tasks.test.js`: embedded search shortcut, unexpected popup rejection and
  down/hung renderer recovery.
- Full suite, lint and Prettier green.

## [2.2.0] - 2026-10-24

### Added

- **PT-BR/EN multilingual support across the application.** Portuguese remains the
  default; `APP_LANGUAGE=en` in `credentials.env` (or `--lang en` on the CLI) enables
  English. Configuration accepts aliases (`pt`, `pt-BR`, `en-US`, `english`, `português`)
  and validates them at boot.
- **Translated logs and reports:** PT → EN catalog covers all static `logger` messages
  (automated coverage test), dynamic values (task statuses, streaks, units and flags),
  consolidated reports, manual login, configuration error messages, CLI help and Telegram
  notifications (including HTML).
- **Bilingual helper scripts on all operating systems:** execution and installation on
  Linux/macOS (`.sh`), Windows CMD (`.bat`) and PowerShell (`.ps1`), plus
  `generate_secret.*`, `docker-run.example.sh` and `push_to_github.sh`. Scripts detect
  `APP_LANGUAGE`, `--lang` and `credentials.env` before printing messages.

### Documentation

- **Full English and Spanish documentation (Spanish was removed in 2.5.0):**
  `README.en.md`/`README.es.md`, `INSTALL_LINUX/INSTALL_WINDOWS/INSTALL_MACOS.en.md/.es.md`
  and `CLOUD_SESSIONS.en.md/.es.md`, with language selectors at the top and preserved
  internal links/anchors. Portuguese remains canonical.
- `README.md`, `README.en.md`, `README.es.md` and `credentials.env.example` document
  `APP_LANGUAGE` and `--lang`.

### Tests

- New `tests/i18n.test.js`: language normalization, message/template translation, login
  menu, notifications and **100% coverage of static logger messages** by the PT → EN
  catalog.
- Full suite: 500 tests passing; lint and Prettier green.

## [2.1.1] - 2026-10-24

### Fixed

- **Expired session was not detected on the new login screens (Oct/2026):** with the
  session invalidated on the server, mobile coin-index showed only "COINS" + "Log in"
  (same URL, no fields) and desktop `mycoin.html` showed "Register/Sign in". Neither was
  recognized: the run failed with "unable to obtain streak and balance"
  (`attemptedLogin: false`, `loginPromptDetected: false`) and `--manual-login` was never
  offered. `shouldAttemptLogin()` now handles the mobile gate (`isLoginGateText()`) and
  `isLoginPromptText()` recognizes the desktop screen.
- **`run_all.sh` disabled `--manual-login`:** Node runs in the background (to forward
  TERM/INT) and, without job control, bash connects asynchronous stdin to `/dev/null`.
  `isManualLoginAvailable()` saw non-TTY stdin and kept headless login even in an
  interactive terminal. Stdin is now preserved with `<&0`; cron/launchd/systemd are
  unchanged (stdin was already not a TTY).

## [2.1.0] - 2026-10-22

### Why this release

The main reason for 2.1.0 is the **AliExpress coin collection page change** (Oct/2026):
the "Earn more coins" panel stopped being a drawer (`.e2e_task`) and rendered the task
list **inline** with `aecoin-*` CSS Modules. Without this adjustment, versions up to
2.0.0 could no longer read tasks (the bot tried to open the drawer 5 times and failed with
"Panel 'Earn more coins' inaccessible"), and the day ended without task coins even though
daily check-in worked.

### Fixed

- **"Earn more coins" panel in inline `aecoin-*` layout (`libs/selectors.js`,
  `libs/tasks/verifier.js`, `libs/tasks/state.js`):** AliExpress replaced the
  `.e2e_task` drawer with an inline list; the old drawer became dead (header without
  button, content stuck loading) and tasks came back empty (`tasks: null` /
  `tasksCoinsGained: 0`). The bot now:
  - detects the inline list in `openTaskDrawer` without trying to open the dead drawer;
  - extracts title, button, reward, round status (`aecoin-progress-*`) and `data-groupid`
    in both layouts, with `[class*="prefix-"]` selectors immune to CSS Modules build
    hashes;
  - classifies `aecoin-btnGo-*` as actionable — in the new layout the button text is the
    reward (`+N`), not the `GO` label — and `btnCollect`/`btnReceive`/… as claimable,
    preserving the old `.e2e_*` behavior as fallback.
- **`findNextPendingTask` recognizes `aecoin-btnGo-*` (`libs/tasks/state.js`):** besides
  `isActionable`/`GO`, the new layout's `btnClass` also marks the task executable
  (defense in depth for rendering variations).

### Tests

- New cases in `tests/tasks.test.js` (inline detection + `aecoin-*` extraction) and
  fixture/smoke of the new panel in `tests/selectors.smoke.test.js`.

### Notes

- Live validation (2026-10-22): inline panel detected, tasks read and executed (daily
  check-in and navigation/scroll tasks completed; the dynamic list expanded during the
  run).
- "Browse surprise items" may not count when the click lands on `adclick.html` without
  opening the product detail. This is surprise-feed behavior, separate from the panel,
  already covered by the bot's fallbacks/late-progress; monitor separately if it recurs.

## [2.0.0] - 2026-10-19

### Added

- **Optional manual login in a window (`libs/ui/manual-login.js`, `collect.js`):** when
  login is needed (no valid session, rejected session/reauthentication, captcha cooldown
  or RGV587 block) and a TTY + graphical interface is available, the bot offers a menu:
  continue 100% headless (default) or open a visible window for the operator to solve
  login/captcha/2FA. On detecting the strong `login_aliyunid_ticket` cookie, the session
  is saved with `freshLogin`, the temporary window is closed and the flow resumes
  headless. The menu is also offered after an anti-bot login failure, without bypassing
  captcha.
- **Manual window in a desktop context by default (`MANUAL_LOGIN_CONTEXT=desktop|mobile`):**
  avoids Pixel 7 touch emulation, which prevented the slider/captcha from responding to
  the mouse in environments such as WSLg. `mobile` re-enables Pixel 7 emulation; the
  headless flow remains mobile either way.
- **Configuration and CLI:** `MANUAL_LOGIN=auto|never|always` (default `auto`),
  `MANUAL_LOGIN_PROMPT_TIMEOUT_MS` (60s) and `MANUAL_LOGIN_TIMEOUT_MS` (15min), plus
  `--manual-login` (same as `always`) and `--no-manual-login` (same as `never`). GUI
  detection covers Windows/macOS and Linux with `DISPLAY`/`WAYLAND_DISPLAY`; in cron,
  Docker, CI or SSH without a display nothing is asked (1.x behavior preserved).
- **Exit code 7 and manual-intervention notification:** RGV587 detected during automatic
  login, closed/timed-out window or manual gate without renewal exit with code 7 (no
  `run_all.sh` retry) and notify `manual_login_required`, distinguishing manual-attempt
  failure from the remote gate. Applies to `all.js`, `collect.js` and standalone
  `do_tasks.js`.

### Fixed

- **Adaptive Node heap in `run*.sh`:** machines with more RAM raise the 256 MB cap to
  384/512 MB (1 GB hosts stay at 256 MB), fixing `JavaScript heap out of memory` in the
  unified flow (check-in + tasks) in one process. `ALI_HEAP_MB`/`NODE_OPTIONS` can force a
  value, and `all.js` now warns when the heap approaches the cap.
- **Manual window recognizes `xman_us_t` besides `login_aliyunid_ticket`:** desktop login
  may write only `xman_us_t`; the wait got stuck even with the coin page open. Detection
  now uses the same strong cookies as `validateSession` and records which signal was
  accepted.
- **`saveSession(..., { freshLogin: true })` clears all anti-bot state
  (`libs/session.js`):** besides `lastCaptchaAt` and imported-session markers, it removes
  `captchaCooldownHours`, `captchaRiskControl` and `captchaRequireManualLogin`. Before, a
  successful manual login kept the 48h RGV587 gate/cooldown active.
- **Invalid session no longer disarms the gate (`libs/session.js`):**
  `validateAndRefresh` removes the expired session while preserving anti-bot fields in
  `session_meta.json` (`clearSession({ preserveAntiBotMeta: true })`), instead of deleting
  the whole meta and reopening automatic login on the next run.

### Tests

- New `tests/manual_login.test.js` (TTY/GUI detection, menu/timeout, ticket wait, window
  reuse, saving and closing) and cases in `tests/config.test.js`, `tests/session.test.js`
  and `tests/captcha_cooldown.test.js` (config/CLI, full freshLogin cleanup, gate
  preservation, notification with manual attempt). Full suite green; lint/format clean.

## [1.7.4] - 2026-10-13

### Fixed

- **Login validation no longer accepts an old cookie as an authenticated session
  (`libs/ui/login.js`):** login is confirmed by strong signals —
  `login_aliyunid_ticket`, `xman_us_t` rotation or a `SUCCESS` return from the
  `loginByPwd` endpoint. Before, the old `xman_us_t` (which survives session expiry) made
  the app save the session as authenticated even when AliExpress rejected the login — a
  false positive found during the RGV587 investigation.
- **Risk-control rejection (RGV587/TMD) becomes an anti-bot challenge
  (`libs/ui/login.js`):** when `loginByPwd` returns `FAIL_SYS_USER_VALIDATE`/`RGV587`,
  login aborts immediately with `isCaptchaChallenge` — `collect.js` records the
  post-challenge cooldown and avoids retries that escalate the risk block.
- **48h cooldown on RGV587 risk blocks (`libs/session.js`, `collect.js`):** challenge
  recording stores custom hours in the account meta (`captchaCooldownHours=48` +
  `captchaRiskControl`), overriding the default `CAPTCHA_COOLDOWN_HOURS` (12h) on read —
  login is suspended for 48h so the AliExpress flag expires, with no new account attempts.
- **`risk_blocked` Telegram notification (`libs/notify.js`, `all.js`, `collect.js`):**
  warns that AliExpress blocked the account for suspected bot use (RGV587), informs the
  remaining cooldown (with release time) and reminds the operator to **manually collect**
  coins while the pause is active. Unlike a normal captcha, the risk block also notifies on
  runs where login is skipped by cooldown (previously silent).
- **Remote login suspended until manual session renewal (`libs/session.js`, `collect.js`,
  `import_session.js`, `all.js`, `libs/notify.js`):** when the risk block ends, the
  cooldown expires but **no remote login attempt is made** — meta keeps the
  `captchaRequireManualLogin` gate, released only when a new session is imported/renewed
  locally. The user receives `manual_login_required` with the steps: local browser login →
  solve captcha if shown → `export_session.js` + `import_session.js`. Without renewal,
  each run only notifies (does not log in), avoiding new blocks; cron is effectively
  released when the imported session arrives.

### Tests

- New tests in `tests/login_reauth.test.js` and `tests/captcha_cooldown.test.js`:
  `ret` classification (RGV587/success), authentication decision (old xman does not
  count), RGV587 abort with 48h cooldown, reading/clearing custom meta hours, manual gate
  after window + release on import, and `risk_blocked`/`manual_login_required` messages
  (remaining time + manual collection + steps); suite at **457/457**; lint/format clean.

## [1.7.3] - 2026-10-06

### Fixed

- **Daily surprise memory separated per account (`libs/tasks/surprise.js`, `do_tasks.js`):**
  the file key now includes the account hash (8-char sha256, same as sessions), producing
  `scratch/surprise_tapped_<date>-<hash>.json`. Before, the file was unique per day: with
  2 accounts, the second could ignore cards the first had tapped (different feeds, same
  signature), wasting items. Without an identified user, the key remains global
  (compatibility).

### Tests

- New test in `tests/tasks.test.js` for `composeSurpriseTappedKey` (same hash as sessions,
  account separation and global fallback); suite at **449/449**; lint/format clean.

## [1.7.2] - 2026-10-02

### Added

- **Surprise feed reload on stagnation (`libs/tasks/surprise.js`):** when all visible cards
  have been tapped, besides scrolling the feed is reloaded once per run (navigation +
  card re-read) to find untapped items before ending the round — the feed often repeats
  the same cards and repeated taps do not count.
- **Daily memory of tapped cards (`libs/tasks/surprise.js`, `do_tasks.js`):** signatures
  of cards tapped that day are persisted in `scratch/surprise_tapped_<date>.json` and
  loaded on the next run, avoiding attempts on items already counted by the panel.
  Read/write failure never interrupts the run, history is capped at 500 signatures per day
  and there is an opt-out with `SURPRISE_REMEMBER_TAPPED=false`.

### Fixed

- **"Explore surprise items" task reopened after late progress (`do_tasks.js`,
  `libs/tasks/state.js`):** when the panel confirms round progress (or status change)
  after the task was marked "no progress", the residual failure is cleared and attempts
  (by title and round) are reset — the next round runs in the same run. Before,
  `failedTasks` stuck: round 2 never ran and the report said "Failed" even when the panel
  already showed the task completed (2/2).
- **Late progress confirmation before giving up (`do_tasks.js`):** when round attempts are
  exhausted, the runner waits ~4s and re-reads the panel once; if the round advanced in
  that interval, the task is reopened — avoiding giving up seconds before AliExpress
  processes the taps (delayed progression).
- **Report does not mask a completed task (`libs/tasks/state.js`, `do_tasks.js`):** final
  classification prioritizes the completed task (even with residual failure) and avoids
  duplicate bullets for the same title.

### Tests

- New tests in `tests/tasks.test.js`: late-progress reopening, confirmation candidate
  selection and report classification; single surprise-feed reload and daily card memory
  roundtrip (invalid file and 500 cap); suite at **448/448**; lint/format clean.

## [1.7.1] - 2026-09-25

### Performance

- **Desktop read shortcut in check-in (`collect.js`):** when nothing was collected in the
  run (`!justCollected`) and the initial check returned a valid balance, step 1 closure
  reuses the initial read — eliminating the redundant second desktop read (~18s baseline).
  After a new collection, the read remains mandatory (credit/streak).
- **Mobile page reuse between check-in and tasks (`collect.js`, `do_tasks.js`, `all.js`):**
  `runCheckin({ keepPage: true })` hands over the page/context already on the coin center
  via `onMobilePageKept`; `runTasks` receives `page`/`context`, skips context recreation,
  navigation and the 8s pre-wait (goes straight to the panel) and closes the context in
  `finally`. Standalone commands (`node collect.js`, `node do_tasks.js`) remain
  autonomous — reuse only happens when the handle is passed.
- **`pino-pretty` moved to `devDependencies` (`package.json`, `logger.js`):** the
  production container (`npm ci --omit=dev`) no longer installs the pretty-printer and
  its transitive dependencies; the logger resolves the module before creating the
  transport and degrades to stdout/JSON without breaking when absent.
- **Leaner Docker build (`.dockerignore`, `Dockerfile`):** host/setup scripts
  (`setup_*.sh`, `push_to_github.sh`, `run*.sh`, `docker-run*.sh`) stay out of the image,
  eliminating the `RUN chmod +x` layer; Chromium is installed by the local binary
  (`./node_modules/.bin/playwright`), without `npx`/transient caches.
- **Ad trackers and efficiency flags (`browser.js`):** Facebook/TikTok/Criteo/Bing Ads are
  aborted in `setupResourceBlocking`, and Chromium receives `--no-pings`,
  `--disable-extensions`, `--disable-notifications` and `--prerender=disabled`. Anti-bot
  cadence (1000ms click, 1500ms scroll) remains intact.

### Fixed

- **24h cap for pauses (`config.js`, issue #21):** `START_DELAY_MAX_MS`,
  `TASK_PAUSE_MAX_MS` and `ACCOUNT_DELAY_MAX_MS` are validated in the schema (max
  `86400000`) with an explicit message — a unit mistake (seconds typed as ms) no longer
  becomes days of silent waiting. The exact limit is still accepted.
- **Initial-delay interruption with node as PID 1 (`all.js`, `libs/exit.js`, issue #22):**
  `docker stop` during the wait now exits with **130/143** (128+n) instead of 0 — as PID 1
  (docker run without `--init`) the kernel ignores the re-emitted signal; shutdown is now
  explicit via `signalExitCode()` + `flushAndExit()`, with a signal-handler exit fallback.
- **Robust suite on small/slow hardware (`tests/`, issue #23):** crash test timeout raised
  to 15s (suite load on modest machines); scrypt roundtrip fixes `N=2^17` in the test (no
  longer depends on host RAM); and the Chromium selector test **skips with a clear
  message** when the browser is not installed (`npm ci --ignore-scripts`).

### Tests

- New regression tests: desktop read reuse (`tests/collect_guard.test.js`), mobile page
  reuse (`tests/do_tasks_reuse.test.js`), Chromium trackers/flags
  (`tests/browser_retry.test.js`), fallback without `pino-pretty` and dependency
  (`tests/logger.test.js`), host scripts out of Docker (`tests/dockerignore.test.js`);
- New issue tests: 24h pause cap (`tests/config.test.js`) and signal exit codes
  (`tests/exit_signal.test.js`); suite at **443/443**; lint/format clean.

## [1.7.0] - 2026-09-25

### Added

- **Check-in confirmed by statement — second verification (`collect.js`,
  `libs/report.js`):** when the UI marker does not confirm the click, TODAY's credit on
  the "Daily bonus" statement line counts as proof that check-in worked: the streak is
  incremented (`confirmedByLedger` in `resolveStreakDays`) and the dynamic page read keeps
  priority when trusted. The fallback only acts if nothing was collected before the run
  (no double increment on re-runs). The report no longer says "Collected successfully
  (+0 coins)" when there was no collection or statement credit: it shows "not confirmed
  in this run".
- **Optional random pause before each task (`TASK_PAUSE_MIN_MS` /
  `TASK_PAUSE_MAX_MS`, default `0`/`0` = off):** panel tasks run chained, with fixed
  1–2.5s waits and no interval between check-in and the first task, at an identical pace
  every day. The two variables draw a uniform pause between MIN and MAX (ms) before each
  task, including the first. The pause happens after selecting the task and before
  executing it, so none is left at the end. Default behavior is exactly the previous one.
  The schema validates `MAX >= MIN`, `--dry-run` shows the configuration (text and JSON)
  and the draw is the pure `pickPauseMs` (`time_utils.js`), covered by tests. Documented
  in `credentials.env.example` and `README.md`. Contribution by
  [@reefbluesky](https://github.com/reefbluesky) via PR #18.
- **Random pause between accounts in multi-account mode (`ACCOUNT_DELAY_MIN_MS` /
  `ACCOUNT_DELAY_MAX_MS`):** with more than one account, draws a uniform pause between MIN
  and MAX (ms) after each account's check-in+tasks and before starting the next,
  randomizing each account start. Default `0`/`0` = off; composes with failure backoff
  **without adding waits** (uses the larger). The account log/notification shows the
  expected next-account time (or that it is the last) and, in the notification, how many
  minutes remain until the next run (the time is in the report timezone and may differ
  from the recipient host). The consolidated message carries the per-account schedule
  (start/end/next). Documented in `credentials.env.example` and `README.md`.
- **Random delay at run start (`START_DELAY_MIN_MS` / `START_DELAY_MAX_MS`):** random wait
  between MIN and MAX (ms) before starting, randomizing start time in any scheduler
  (cron/launchd/Windows Task Scheduler/Docker) without depending on a shell. Default
  `0`/`0` = off; **never delays `--dry-run`** (Docker HEALTHCHECK) and can be skipped with
  `--no-delay` (manual runs and `run_all.sh` retry). The wait is before lock/browser
  (nothing held), interruptible by SIGINT/SIGTERM and checks wall clock in chunks
  (survives suspend). Heartbeat tolerance must be greater than or equal to the delay cap.
  Documented in README, `credentials.env.example` and `INSTALL_*`.

### Fixed

- **Check-in statement-marker wait respects `NAV_TIMEOUT_SHORT`
  (`libs/ui/balance.js`):** the wait for `text=App daily check-in` used a fixed 6s and did
  not follow timeout adjustments for slow pages; it now uses the same `timeout` as the
  statement read (20s default, configurable). Contribution by
  [@reefbluesky](https://github.com/reefbluesky) via PR #19.
- **Streak break confirmed by statement before alert (`collect.js`, `libs/report.js`):**
  when the screen reads `1` with previous history > 1, the desktop statement streak is
  consulted (with on-demand re-read when unavailable) before treating it as a break —
  avoiding a false positive at day rollover (observed on 09/25: `221 → 1` on screen with
  the real streak preserved in the statement). Without a statement, keeps the
  conservative alert; the alert records `statementStreak` for diagnosis.
- **Documentation aligned with new options (`README.md`, `CLOUD_SESSIONS.md`,
  `docker-run.example.sh`):** the README flag table lists `--no-delay`; the heartbeat
  guide records that tolerance (Grace Time) must be **≥ the `START_DELAY_MAX_MS` cap**
  (the start ping only goes out after the wait); the cloud guide now recommends a **fixed
  time** in the scheduler + the app's own random delay (portable across
  cron/launchd/Scheduler/Docker); and the Docker run example mentions the delay and
  `--no-delay` forwarding.

### Tests

- New tests for the second check-in verification (`tests/collect_guard.test.js`,
  `tests/streak_break.test.js`, `tests/report.test.js`): statement confirmation increments
  the streak, dynamic read has priority, weekly cycle does not break it, without
  confirmation the base is preserved, and report lines no longer announce "Collected
  successfully (+0)". Suite at **433/433**; lint/format clean.
- PR #19 regression in `tests/balance.test.js`: the statement check-in marker wait must use
  the configured `timeout` (fails with the fixed 6s value).
- PR #18 tests (`tests/time_utils.test.js`, `tests/config.test.js`): `pickPauseMs`
  (extremes, invalid values, `max < min`) and configuration (`TASK_PAUSE_*`: default off,
  valid range and rejection of `MAX < MIN`).
- Account pause tests (`tests/config.test.js`, `tests/time_utils.test.js`,
  `tests/notify.test.js`, `tests/report.test.js`): `ACCOUNT_DELAY_*` validation (default,
  range, `MAX < MIN`), `composeAccountWaitMs` (larger wait, never adds),
  `getReportTimeZoneLabel`, "next/last account" line in notifications and schedule
  (start/end/next) in the payload and multi-account render.
- Statement-break confirmation tests (`tests/streak_break.test.js`,
  `tests/collect_guard.test.js`): reading `1` disproved by the statement does not break;
  statement confirming (`1`) or unavailable keeps the alert; reads other than `1` are
  unaffected.
- Initial-delay tests (`tests/config.test.js`, `tests/time_utils.test.js`):
  `START_DELAY_*` validation (default, range, `MAX < MIN`), `shouldApplyStartDelay`
  (dry-run and `--no-delay` never delay), `isNoDelay` and `waitUntilWallClock` (chunked
  wait, target already passed/suspend and AbortSignal interruption).

## [1.6.2] - 2026-09-24

### Added

- **Post-captcha cooldown (`collect.js`, `libs/session.js`):** when login encounters an
  anti-bot challenge (captcha), the instant is stored in account meta (`lastCaptchaAt`)
  and new login attempts are **paused for `CAPTCHA_COOLDOWN_HOURS`** (default 12h; `0`
  disables). Insisting on login escalates the challenge and block risk — cooldown is
  checked before any attempt.
- **`captcha_required` notification event (`libs/notify.js`, `all.js`):** captcha failures
  stop being "generic failure" and get a dedicated message (individual and multi-account
  consolidated, with account list) with the recommended action — renew the session
  locally (residential network) and import with `import_session.js`. `libs/ui/login.js`
  marks the error with `isCaptchaChallenge`.
- **Captcha notification dedupe (`all.js`, `libs/notify.js`):** a **new** captcha notifies
  once; subsequent runs blocked by cooldown **do not repeat** the message (heartbeat keeps
  signaling failure for monitoring). When the window expires, a
  `captcha_cooldown_released` notice is sent and the marker is cleared (no repeated
  notice).
- **Forced collection ignoring cooldown (`--force`/`-f`):** the flag already used to
  override an active lockfile now also **ignores the post-captcha cooldown**, allowing a
  login attempt inside the pause window (log `--force: post-captcha cooldown ignored`).
  Documented in `--help` and the README flag table.

### Fixed

- **Effective cooldown before login (`collect.js`):** the new
  `checkCaptchaCooldownForLogin` wrapper guarantees the asynchronous meta read (`await`) —
  without it `active` was `undefined` and the pause window **did not block** login.
- **Importing a new session clears the post-captcha cooldown (`import_session.js`):** the
  meta written on import explicitly drops `lastCaptchaAt` — a previous anti-bot block does
  not prevent login with the newly imported session (defensive reinforcement for tokens
  that might carry the field).
- **Successful new login also clears the cooldown (`libs/session.js`):** in
  `saveSession(..., { freshLogin: true })`, `lastCaptchaAt` is removed with the imported
  session markers — the challenge was overcome and the pause no longer exists.

### Tests

- New tests in `tests/captcha_cooldown.test.js` (cooldown window, meta roundtrip,
  notification dedupe, event messages, new login and import clearing cooldown) + error
  marking case in `tests/login_reauth.test.js`; suite at **412/412**; lint/format clean.
- **Tests independent of real DNS (`tests/report.test.js`, `tests/test_helper.js`):**
  webhook tests mock `fetch`, but the SSRF guard resolved the hostname on the network — a
  slow DNS on the macOS runner failed 2 CI tests (`Timed out resolving destination DNS`).
  The new `stubDnsLookup()` helper replaces resolution with a deterministic public IP (the
  guard stays active), eliminating the flake.

## [1.6.1] - 2026-09-24

### Fixed

- **In-page reauthentication prompt detection (`collect.js`, `libs/ui/login.js`, issue
  #17):** AliExpress started showing a prompt asking for **only the password**
  (recognized account) on the **same URL** as coin-index (SPA). Because `needsLogin` was
  tied to the login/passport URL, automatic login was **never attempted**
  (`attemptedLogin: false`) and the run failed with `N/D` balance. A **visible password
  field** now triggers authentication regardless of URL, and `performMobileLogin` gained a
  **password-only** flow (no username field), with the same 2FA/cookie validation and
  session save (`freshLogin`). The decision was extracted into the pure
  `shouldAttemptLogin` helper (exported and tested).
- **Desktop login-screen diagnostics (`libs/ui/balance.js`):** balance reading now detects
  the login/reauthentication prompt (prompt text or visible password field) and returns
  `loginPromptDetected`, distinguishing "invalid session" from "layout change";
  `collect.js`'s session guard records the signal in the error context.

### Tests

- New tests in `tests/login_reauth.test.js` (`shouldAttemptLogin` decision, prompt
  detection and password-only flow with stubs) and `tests/balance.test.js` (prompt
  signaling). Suite at **401/401**; lint/format clean.

## [1.6.0] - 2026-09-24

### Fixed

- **Defensive Playwright route handling (`browser.js`):** the route interceptor
  (`setupResourceBlocking`) now attaches `.catch(() => {})` to all `route.abort()` and
  `route.continue()` calls, preventing unhandled promise rejections (`Target closed` or
  `Route is already handled`) during concurrent navigation or page/context disposal.
- **Captcha slider-handle selector refinement (`libs/selectors.js`):** `sliderHandle`
  replaced the generic `div[id*="nocaptcha"] span` with specific targets using the control
  class (`div[id*="nocaptcha"] .btn_slide`), avoiding false positives when trying to drag
  static loading elements (such as `<span class="nc-lang-cnt">`).
- **Handle/Locator polymorphism when opening the drawer (`libs/tasks/verifier.js`):** the
  `taskBtn` click fallback now supports `taskBtn.evaluate((el) => el.click())`
  transparently for both `Locator` and `ElementHandle` instances, eliminating errors when
  passing Locators directly to `page.evaluate()`.
- **Contextual scope in modal/dialog buttons (`libs/ui/navigation.js`):** Playwright text
  selectors (`button:has-text(...)` such as OK, Confirm, Close) in `closeModals` now check
  `el.closest(...)` to ensure they are clicked only inside a legitimate
  modal/dialog/overlay container, avoiding accidental clicks on same-named buttons on the
  main page.
- **Playwright trace permission hardening (`libs/ui/diagnostics.js`):** `.zip` trace files
  generated on the failure path now receive restricted `0600` permission via
  `safeChmod600`, aligned with the data-security policy for screenshots and DOM hashes.
- **Constant-time secret comparison without length leakage (`libs/session.js`):**
  `secretsEqual` now computes fixed-size SHA-256 digests (32 bytes) before calling
  `crypto.timingSafeEqual`, eliminating the early return on length mismatch that created a
  timing side channel.
- **Strict entropy/whitespace validation in `SESSION_SECRET` (`security.js`,
  `export_session.js`, `import_session.js`):** rejects keys made only of whitespace or
  artificial padding via `secret.trim().length < 32`.
- **Token path sanitization in multi-account (`export_session.js`):** strictly confines the
  numeric account index when generating `session_token_${index}.txt`.
- **Webhook log hygiene (`libs/notify.js`):** sanitizes rejection error responses from
  notification gateways before logging via Pino.
- **Graceful shutdown in standalone mode (`collect.js`, `do_tasks.js`):** actively closes
  the Chromium child process with a 3s timeout before releasing the lockfile when
  interrupted via `SIGINT`/`SIGTERM`, preventing orphan ~180MB instances.
- **Bounded timeout in diagnostics capture (`libs/ui/diagnostics.js`):** explicitly limits
  `page.screenshot()` and DOM hash evaluation to 5000ms on the error path, preventing
  process hangs during Docker container shutdown.
- **Fail-fast in Dependabot auto-merge workflow
  (`.github/workflows/dependabot-automerge.yml`):** validates changes to
  `.github/workflows/**` in the first second of execution before the 20-minute CI polling,
  saving runner quota and strengthening the supply-chain gate.
- **Chromium binary cache in multi-OS CI (`.github/workflows/ci.yml`,
  `.github/workflows/release.yml`):** caches Playwright binaries per operating system via
  `actions/cache@v4`, avoiding repeated ~130MB downloads per runner on every push.

### Tests

- Coverage added for `setupResourceBlocking` route-failure handling, `closeModals` scope,
  drawer button evaluation polymorphism, whitespace secret rejection and constant-time
  cryptographic comparison; defensive page closure added in `tests/selectors.test.js`;
  suite expanded to **396 tests (100% pass)**.

## [1.5.5] - 2026-09-24

### Fixed

- **Windows log encoding (`run_all.ps1`, `run.ps1`, `run_tasks.ps1`,
  `setup_windows.ps1`):** PowerShell scripts are now written with **UTF-8 BOM** — Windows
  PowerShell 5.1 reads `.ps1` without BOM as ANSI (system code page) and broke script
  accents. Regression test added in `tests/windows_scripts.test.js`.
- **Log colors only when the terminal supports them (`logger.js`):** `pino-pretty` no
  longer forces `colorize: true` and uses `process.stdout.hasColors()` (which also respects
  `NO_COLOR`/`FORCE_COLOR`) — avoids raw ANSI codes in legacy consoles.

### Documentation

- `README.md`: Windows encoding note when running `npm start`/`node` directly
  (`chcp 65001` first, or use the provided scripts).
- `INSTALL_WINDOWS.md` (section G): in PowerShell 5.1, `>`/`>>` redirection writes
  **UTF-16LE** ("broken" log in tools expecting UTF-8); alternatives (`Out-File -Encoding
utf8` or CMD) and how to view the log are documented.

### Tests

- Suite at **391/391**; lint/format clean.

## [1.5.4] - 2026-09-23

### Fixed

- **Consolidated failure notification now identifies affected accounts
  (`libs/notify.js`):** when any account failed in multi-account mode, the event became
  `failure` and the consolidated message fell back to the generic "Unknown error during
  processing." — without saying which account failed (the `❌` list was only rendered on
  success/already collected). The multi-account report is now rendered on failure too,
  with title `🔴 ... (Failure)`, `S/T` summary, per-account list (including
  `❌ Failure (error)`), remote-session warning when applicable, duration, date and host.
  The rule of not attributing the alert to a single `Account:` line is preserved (Bug 15).

### Tests

- Regression in `tests/notify.test.js` (consolidated failure lists accounts with `❌` and
  does not use "Unknown error"); suite at **391/391**; lint/format clean.

## [1.5.3] - 2026-09-23

### Changed

- **`undici` 7.29.1 → 8.11.0** (production dependency; Dependabot PR #9): project usage is
  limited to `undici.Agent({ connect: { lookup } })` and `undici.fetch` in
  `libs/url_guard.js` (anti-rebinding DNS pinning), a stable API in line 8. v8 breaking
  changes (legacy wrappers removed, global dispatcher isolation and HTTP/2 by default) do
  not affect this usage, and line 8 includes the latest security fixes.
- **Local development Node updated to 22.23.2** (same as the Docker image): `undici@8`
  requires Node ≥ 22.19; CI (`node-version: 22`) and the image were already compatible.

### Tests

- Suite at **390/390** (including `tests/url_guard.test.js`, 12/12); lint/format clean;
  `--dry-run --json` validated with Node 22.23.2 + undici 8.11.0.

## [1.5.2] - 2026-09-23

### Changed

- **`dotenv` 17.4.2 → 18.0.3** (production dependency; Dependabot PR #8): v18 adds its own
  CLI and optional fast parser (`config({ fast: true })`), moves the injection message to
  `stderr` and removes features unused by the project (`.env.vault`, preloading and tips).
  The project only uses `dotenv.config({ path, quiet: true })` in `logger.js`, `config.js`,
  `export_session.js` and `import_session.js` — behavior preserved, with `quiet` still
  supported and no noise on `stdout`/`stderr`.

### Tests

- Suite at **390/390**; lint/format clean; `node all.js --dry-run --json` validated with
  18.0.3 (valid config, 2 accounts detected, no extra dotenv output).

## [1.5.1] - 2026-09-22

### Fixed

- **Invalid session no longer reported as a normal run (`collect.js`):** the check-in guard
  accepted `streakDays` inherited from `previousStreakDays` (last good day metadata) as
  proof of a live session; with `N/D` balance — always read fresh, no fallback — the run
  ended with ✅, `+0 coins` and `N/D` balance even with cookies invalidated by AliExpress.
  A missing `totalBalance` (`N/D`/null) now interrupts the run with a login error, triggering
  the existing imported-session-expired alert (`isImportedSessionExpired`) in
  `libs/notify.js`. The session remains **preserved** (cleanup stays in
  `validateAndRefresh`, only with expired-cookie evidence) and `run_all.sh` keeps the single
  exit-1 retry for transient failures.

### Documentation

- `TELEGRAM.md`: fixed the multi-account single-chat description (the consolidated message
  is always sent; the individual one is suppressed with `TELEGRAM_PER_ACCOUNT=false`),
  documented `TELEGRAM_PER_ACCOUNT` in the `credentials.env` example and feature list, and
  replaced message examples with the real formats (individual, consolidated and failure
  with expired session).
- `setup_linux.sh`: step numbering aligned (8 steps, including the User Namespaces/AppArmor
  restriction check).

### Tests

- Regression in `tests/collect_guard.test.js` (`N/D` balance with cached streak → invalid
  session); suite at **390/390**; lint/format clean.

## [1.5.0] - 2026-09-22

### Performance and Efficiency

**Round 3:**

- **V8 bytecode cache (`NODE_COMPILE_CACHE`, Node 22+):** `Dockerfile` sets
  `NODE_COMPILE_CACHE=/tmp/node-compile-cache` (`/tmp` on tmpfs in runs with
  `--shm`/tmpfs, so compiled `playwright`/`pino`/`zod` bytecode stays in RAM) and
  `run_all.sh`/`run.sh`/`run_tasks.sh` use `/tmp/ali-coins-compile-cache-$UID` (per-user
  isolated folder, existing value preserved). Reduces process startup and healthcheck
  time.

**Round 2:**

- **Mobile check-in without redundant navigation (`collect.js`):** the mobile context first
  navigated to desktop `mycoin.html` and, on the next line, discarded the page for the
  mobile URL. It now goes **directly** to `m.aliexpress.com/p/coin-index/index.html` (the
  context already inherits cookies from `storageState`), with the defensive fallback kept
  if the site redirects to desktop — saving 3–6s of network/CPU and ~25–40 MB of heap per
  account.
- **`/dev/shm` detected dynamically (`browser.js`):** new `shouldDisableDevShmUsage()` —
  does not apply the flag on Windows/macOS; on Linux uses `fs.statfsSync('/dev/shm')` and
  adds `--disable-dev-shm-usage` only when free space is **< 128 MB** (default Docker
  64 MB). On native hosts or containers with `--shm-size=256m`, Chromium uses tmpfs in RAM
  again (avoids disk I/O for buffers). `statfs` failure falls back defensively (applies
  the flag).
- **Standardized V8 heap in native scripts (`run_all.sh`, `run.sh`, `run_tasks.sh`):**
  `export NODE_OPTIONS="${NODE_OPTIONS:--max-old-space-size=256}"` — same container
  protection against OOM Killer when automation runs directly on the VPS via cron
  (existing value preserved).
- **BuildKit cache mounts and `docker-compose.yml` (`Dockerfile`, `.dockerignore`):** apt
  and npm caches stay **outside the image** (`--mount=type=cache`), speeding rebuilds;
  reference `docker-compose.yml` created with `shm_size: 256m`, tmpfs `/tmp`,
  `cap_drop: [ALL]`, `no-new-privileges`, 768M limit and binds with
  `create_host_path: false` (clear failure if a required file is missing).

**Round 1:**

- **Leaner, cheaper container (`Dockerfile`, `docker-run.example.sh`):** download caches
  (Playwright/apt) removed in the same layer (`rm -rf /root/.cache /tmp/*`);
  `NODE_OPTIONS=--max-old-space-size=256` (GC headroom without pressing 1 GB hosts);
  `HEALTHCHECK` with `--interval=10m` and `--start-period=90s` (less background CPU);
  `--shm-size=256m` and `--tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m` in the example,
  preventing Chromium rasterization/render buffers from writing to the `overlay2` layer.
- **Less network/IPC overhead in Playwright (`browser.js`):** resource blocking decides by
  `resourceType()` first (image/media/font aborted **without** materializing URL or
  running regex); extension regex is restricted to generic types (`other`) and telemetry
  remains blocked by substring. `--disable-animations` and `--disable-smooth-scrolling`
  added to CPU-saving flags.
- **Skeleton end detected faster (`libs/tasks/verifier.js`):** self-healing loop changed
  from fixed 1s sleeps (12 iterations) to checks every **350ms** (25 iterations, ~9s
  total), with defensive reload kept at ~6s — saving 2–4s per account when the DOM
  stabilizes early.

### Fixed

- **False schema warning in unified report (`libs/report.js`):** null `meta.tasksError`
  (when the tasks stage did not fail) is now omitted from the payload instead of sent as
  `null` — the schema accepts an optional string, so "Payload diverges from schema" no
  longer appears. The divergence was latent while per-account sending was disabled (the
  individual payload is only built with `TELEGRAM_PER_ACCOUNT=true`); the multi-account
  builder already normalized (`item.tasksError || undefined`).

### Tests

- Suite kept at **389/389**; lint (`--max-warnings=0`) and format clean.

## [1.4.8] - 2026-09-22

### Fixed

- **Check-in confirmation with a larger margin (`collect.js`):** the "today" marker
  `waitForSelector` increased from **2s → 3s**. In the real 09/22 run the first click
  registered, but the marker took more than 2s to appear; the bot moved to the next
  selector (redundant click and unnecessary warnings). With 3s, confirmation happens on
  the first attempt in most cases, keeping the cascading fallback when really needed.

### Security

- **`NOTIFY_WEBHOOK_URL` validated at boot (`config.js`):** the webhook URL was only
  evaluated at runtime, so malformed or clear `http://` URLs passed startup. The schema now
  validates format (`http(s)://` + `new URL()`) and rejects `http://` for non-loopback
  external destinations, requiring `https://` — accepting `http://` only for loopback
  (`localhost`, `127.0.0.0/8`, `::1`, `::ffff:127.x`) or with
  `ALLOW_PRIVATE_WEBHOOKS=true`, identical to `HEARTBEAT_URL`. `--dry-run` reflects the
  validated value.
- **`NOTIFY_HOST_LABEL` sanitized and escaped (`config.js`, `libs/notify.js`):** the label
  is truncated to **64 characters** in the schema and `escapeHtml` now also converts `"`
  to `&quot;` (before only `<`, `>`, `&`), preventing a label with `<`/`&`/`"` from
  breaking the Telegram API HTML entity parsing (HTTP 400).
- **Defensive alert without the pinned connector (`libs/url_guard.js`):** when `undici` is
  absent (or `Agent` cannot be created), transport falls back to native fetch **with an
  explicit warning, once per process**, stating that pinned-lookup anti-DNS-rebinding is
  disabled and SSRF mitigation is limited to prior DNS resolution.

### Tests

- +5 tests: `NOTIFY_WEBHOOK_URL` validation (HTTPS, HTTP loopback, public HTTP rejected,
  opt-in, invalid scheme), label truncation, label HTML escaping, and the idempotent
  warning when `undici` is absent; total **387**.

## [1.4.7] - 2026-09-21

### Fixed

**Round 3 (navigation timeout and CI):**

- **`NAV_TIMEOUT_SHORT` from 15s → 20s (`config.js`):** more margin for slow pages in
  short navigations (task click/redirects), keeping the per-attempt cap
  (`TASK_MAX_DURATION_MS`) intact. Value documented in README and
  `credentials.env.example`.
- **Fragile `buildMessage` test fixed (`tests/notify.test.js`):** the assertion looked for
  literal `"456"` in the whole message and the macOS runner's random hostname could contain
  those digits (red CI on macOS). The assertion is now context-specific (`code=456`).

**Round 2 (post-release sweep):**

- **CRITICAL — standalone `import_session.js` always exited 1:** the CLI destructured
  `{ imported, failed }` also in the single path (which returns the result directly),
  causing a `TypeError` and exit 1 even with the session imported. Normalization became
  `normalizeImportCliResult()` (tested).
- **HIGH — signal shutdown worked again:** the `listenerCount > 1` guard was evaluated
  **inside** a `once` handler (the listener was already removed → always 0/1). The decision
  is now made at **registration**: if the app (`all.js`) already handles the signal, the
  lockfile does not register its own handler and the full shutdown (browser → lock → flush)
  runs.
- **MEDIUM — claim restoration without overwriting (`lockfile.js`):**
  `restoreClaimSafely()` uses `link` (fails with `EEXIST` if another process published in
  the interval) with a fallback for filesystems without hardlinks; `renewLockByRewrite` no
  longer reports a successful renewal when ownership was lost.
- **MEDIUM — `http://[::1]` and loopback variants accepted in heartbeat (`config.js`):**
  `URL.hostname` for IPv6 includes brackets; the check now normalizes and covers
  `127.0.0.0/8` and `::ffff:127.x`.
- **MEDIUM — `trySolveSlider` confirms on the right target (`libs/ui/navigation.js`):**
  `waitForSelector(detached)` ran on the main frame even when the handle was in an iframe,
  returning `true` without the captcha disappearing.
- **MEDIUM — check-in tries the next selectors (`collect.js`):** the `break` was
  unconditional; it now ends the list only when the click is confirmed (cascading fallbacks
  work again).
- **MEDIUM — `do_tasks.js` does not report "no action" when there were failures:** the
  result includes `failedTasks` and the CLI exits 1 (retryable) when there were no actions
  but real failures exist, instead of exit 2.
- **LOW:** `encryptLocalSession: 'off/no'` respected in options and correct message in
  `--migrate`; `LOG_LEVEL` normalized (trim/case) and `silent` accepted by the schema;
  ledger credit in check-in **text** and **webhook**; batch summary tolerates migration
  result; `SSRF_BLOCKED` propagation traverses the `cause`/`AggregateError` chain;
  `HEARTBEAT_ENABLED=` empty treated as unset; Chromium env regex covers
  `pass`/`senha`/`bearer`; `resolveStorageState` logs decrypt failure; `pingFail` sanitizes
  errors; webhook cap measured in bytes on the first check; `surprise` does not reopen an
  already tapped card; `waitForLoadState` with timeout; retry jitter does not exceed the
  cap; `recordTaskAttempt` validates the map; batch CLI JSDoc updated.

**Round 1:**

- **`ALLOW_PRIVATE_WEBHOOKS=true` works again with DNS pinning (`libs/url_guard.js`):**
  validation read the environment opt-in, but the pinned dispatcher used strict mode
  (default) — the private destination was allowed in the check and blocked on connection.
  The opt-in is now resolved **once** and passed to both validation and dispatcher; the
  connector block (wrapped by undici in `TypeError: fetch failed`) is propagated as
  `SSRF_BLOCKED`, preserving caller handling.
- **`ENCRYPT_LOCAL_SESSION=off/no` respected at runtime (`libs/session.js`):** the schema
  accepted `off/no/0/false`, but `getEncryptionConfig` only recognized `false`/`0` — with
  `off` the process still required `SESSION_SECRET` (and without it did not persist the
  session). Runtime and schema now use the same value set.
- **`HEARTBEAT_URL` validated with a URL parser (`config.js`):** the regex accepted
  `http://localhost:8080@evil.com` (real hostname `evil.com`) and rejected
  `http://localhost?k=v`. It now uses `new URL()` and compares `hostname`;
  `ALLOW_PRIVATE_WEBHOOKS` is read by the same runtime helper (`allowPrivateTargets`,
  accepting `1/on/yes`).
- **Invalid `LOG_LEVEL` no longer crashes with a stack trace (`logger.js`):** pino threw at
  `require` (before `ConfigValidationError`). Now falls back to `info` with a stderr warning
  and schema validation remains actionable.
- **Lockfile: backward clock does not remove a live lock (`lockfile.js`):** a "future"
  `createdAt` (corrected NTP/snapshot) zeroed age and ignored a freshly renewed `mtime`.
  The real renewal `mtime` now takes precedence over invalid/future `createdAt`; future
  `mtime` remains ignored (anti-DoS).
- **Lockfile: fallback when `utimes` is unavailable (`lockfile.js`):** filesystems without
  support (network/FAT mounts) let the lock expire while the run continued; it now renews by
  **conditional rewrite** (claim + generation check), without overwriting another lock.
- **Signal shutdown is no longer overridden by the lockfile (`lockfile.js`):** when another
  component (e.g. `all.js`) handles the signal, the lockfile does not release the lock or
  re-emit the signal — the app conducts the full shutdown (close browser → release lock →
  flush). Without another handler, standalone behavior is kept.
- **Check-in notification counts statement credit (`libs/notify.js`):** the reduced object
  discarded `checkinCoinsFromLedger` and Telegram showed "+0 coins" even with credit
  confirmed that day.
- **Mobile context does not leak if `newPage()` fails (`collect.js`):** page creation is
  now inside the `try` that closes the context (avoids an orphan context in the shared
  browser).
- **Per-account event aligned with consolidated (`all.js`):** individual notification
  considers `checkinCoinsFromLedger` as a new action, like the unified report.
- **Standalone `collect.js` aligned with unified (`collect.js`):** credit confirmed in the
  statement counts as a new action (exit 0 instead of 2).
- **Batch exit codes in `import_session.js`/`export_session.js`:** total **or partial**
  failure exits 1 (before, one imported/exported account masked the others that failed).
- **Swallowed errors are now visible:** failure to persist the session after check-in
  (`collect.js`) and failure reading the statement at the end of tasks (`do_tasks.js`).

### Cleanup

- Dead code removed: `isPlaintext()`/`sessionEncPath` (config), `calculateAccountBackoff`
  re-export (all.js).
- `npm run lint` now uses `--max-warnings=0` (test warnings adjusted); `.prettierignore`
  covers `session_token*.txt`, `session_meta*.json` and `*.enc`.
- Documentation fixed: **v3** format (was "v2" in `export_session.js`/README), complete
  README flag table (`--all`, `--account`, `--plaintext`, `--keep-tokens`, `--heartbeat`,
  `--rotate`, `--migrate`), `CLOUD_SESSIONS.md` with
  `SESSION_BACKUP_RETENTION_DAYS`/`DIAGNOSTICS_RETENTION_DAYS`, `RELEASING.md` updated for
  1.x, tracing documented per low-memory mode.

### Documentation

- **Advanced variables documented** (before in no doc): `REPORT_TIMEZONE` (noting that the
  statement/streak accounting "day" is always `America/Los_Angeles`),
  `LOCK_STALE_TIMEOUT_MS`, `ACCOUNT_BACKOFF_BASE_MS`, `SELECTOR_TIMEOUT`,
  `ELEMENT_TIMEOUT`, `NAV_TIMEOUT_SHORT`, `SCROLL_WAIT_SECONDS`,
  `SESSION_STRICT_STORAGE`, `SURPRISE_DETAIL_FALLBACK`,
  `PW_OUTPUT_DIR`/`PW_SCREENSHOT`/`PW_VIDEO`, `HEARTBEAT_ENABLED` and
  `NOTIFY_HOST_LABEL` — added to `credentials.env.example` and the README configuration
  block.
- **`LOG_LEVEL`:** value list fixed (includes `fatal` and `silent`) in README and example.
- **Security:** documented DNS pinning (lookup via `undici`) applied to
  webhooks/heartbeat.
- **`NOTIFY_HOST_LABEL` mapped in `rawEnv`** (the schema validated a variable that never
  reached validation/dry-run).
- **Complete `--help`:** `--migrate`, `--rotate` and `--new-secret-from-env` now appear in
  the built-in help.
- **Cleanup:** `.gitignore` uses `ali-coins*.lock` (real per-UID lock name);
  `.dockerignore` no longer ignores nonexistent config files (`commitlint`/`lint-staged`).

## [1.4.6] - 2026-09-21

### Security

- **Legacy session tokens migrated to v3 (`libs/session.js`):** a `session.json.enc` in v1
  format (shared **fixed** salt) or v2 (old parameters) was decrypted indefinitely. After
  successful decryption, the token is re-encrypted with v3 (random per-token salt + current
  parameters) using the session already in memory; migration failure keeps the current
  token without interrupting the flow.
- **`HEARTBEAT_URL` requires `https://` (`config.js`):** the dead man's switch token goes
  in the path and traveled in clear text over `http` (could be forged). `http://` is now
  accepted only for `localhost`/`127.0.0.1`/`[::1]` or with `ALLOW_PRIVATE_WEBHOOKS=true`.
- **Telegram timeout does not duplicate messages (`libs/notify.js`):** timeout/abort is
  ambiguous (the POST may have arrived and only the response was slow); resending
  duplicated the notification on the channel. Timeout is now not retried (logs a warning);
  network errors that provably did not arrive still retry.
- **Signal shutdown closes the browser before releasing the lock (`all.js`):** the handler
  is registered **before** the lockfile, so `SIGINT`/`SIGTERM` close Chromium (in-flight
  requests) and only then release the lock, preventing another instance from starting the
  same account while the previous process is still finishing.

### Fixed

- **Runtime report contract (`libs/report.js`):** Zod schemas were only used in tests;
  builders now validate the payload and log a warning when a field diverges (without
  blocking sending), making the JSON contract verifiable in production.

### Tests

- +4 tests: `HEARTBEAT_URL` (public http blocked / https / localhost), runtime contract of
  unified and multi-account payloads, ambiguous Telegram timeout without retry and v2→v3
  session token migration; total **379**.

## [1.4.5] - 2026-09-21

### Security

- **SSRF: DNS rebinding eliminated in `safeFetch` (`libs/url_guard.js`):** validation
  resolved DNS and `fetch` resolved again on connection (TOCTOU): a TTL-0 hostname could
  return a public IP at check time and private/metadata at connection time. Transport now
  uses **undici with pinned `lookup`**: the IP validated during resolution is the same used
  for the connection (SNI/Host preserved), revalidating each redirect hop. Without undici,
  it degrades to the previous behavior (DNS validation) without breaking; `global.fetch`
  mocks remain respected in tests.
- **Lockfile: renewal by `mtime` (`lockfile.js`):** periodic refresh overwrote the lock by
  unconditional `rename` after checking ownership — another generation assumed in the
  window was overwritten. Renewal now updates only the lock **mtime** (atomic, without
  rewriting content or an absence window) and the stale criterion considers `createdAt`
  **or** `mtime` (invalid/future timestamp remains immediately stale, anti-DoS). The read
  grace period also applies to `ENOENT`, so a momentary removal/renewal is not treated as
  "lock absent" and a second process takes over.
- **`SESSION_SECRET` required with active encryption (`config.js`):** with
  `ENCRYPT_LOCAL_SESSION=true` (default) without `SESSION_SECRET`, `saveSession` refused to
  write and the session never persisted — the error only appeared in the save log. Startup
  validation now fails with an actionable message; `ENCRYPT_LOCAL_SESSION=false/off/no/0`
  remains the explicit opt-out.
- **`passwordFile` validates the real path (`config.js`):** a symlink inside the
  `accounts.json` directory pointing outside bypassed the lexical check; `realpath` is now
  revalidated before reading.
- **Sanitized heartbeat error (`libs/heartbeat.js`):** `err.message` could stringify the URL
  with token; it now goes through the secret redactor in logs and the return value.
- **Confined session backup (`libs/session.js`):** `clearSession` wrote the backup to an
  injected `scratchDir` without validation (could export the blob to an arbitrary
  directory); it now applies the same barrier as `pruneSessionBackups` and only logs a
  warning when the directory is outside scratch.

### Fixed

- **`rotateSessionSecret` serialized (`libs/session.js`):** now uses the per-path mutex,
  eliminating the race with `saveSession` in the same process (rotation overwrote the
  newly written session).
- **`crash.js` flushes logs before emergency exit:** the 15s timer called `process.exit(6)`
  without draining the logger buffer; the last fatal log lines now reach stderr.
- **`surprise.js` counts only effective clicks:** `clickedCount` incremented even with
  `clickSucceeded=false`, inflating the return and detail gate.
- **`search.js` uses a specific visible search field:** the document's first `<input>`
  (often hidden/CSRF) made `fill` fail silently; it now prioritizes search selectors and
  falls back to the first visible input.
- **Telegram: UTF-16 and entity truncation (`libs/notify.js`):** truncation was by code
  points and could exceed 4096 UTF-16 units with astral emojis; it now respects the real
  limit and removes a partial HTML entity at the end. The plain-text fallback unescapes
  `&amp;`/`&lt;`/`&gt;`/`&quot;`.
- **Webhook above 32 KB sends a valid minimal payload (`libs/report.js`):** the generic
  truncated body had no `content`/`text` and was rejected with 400 (lost notification); it
  now builds `{content}` (Discord) or `{text}` (Bot API) with the summary.
- **`flushWebhooks` waits for webhooks started during the flush
  (`libs/webhooks.js`):** repeats until empty (with a time cap), instead of snapshotting
  the Set once.
- **`--dry-run` shows the webhook (`config.js`):** JSON and text summaries indicate
  `NOTIFY_WEBHOOK_URL` configured and `ALLOW_PRIVATE_WEBHOOKS=true` (previously invisible
  in diagnostics).
- **Login: fallback validates visibility (`libs/ui/login.js`):** direct `page.$` could
  return a hidden input and throw a raw error on `fill`.
- **Multi-account: correct "Final Balance" (`libs/report.js`):** reuses
  `computeFinalBalance` normalizing the suffix — no longer prints `N/D coins` or
  `N coins coins`.
- **Docker: `CMD ["node","all.js"]` + `STOPSIGNAL SIGTERM` (`Dockerfile`):** eliminates the
  intermediate `npm`/`sh -c` process as PID 1, improving signal forwarding on
  `docker stop`.
- **`.gitignore`/`.dockerignore`:** added `.env*`, `.npmrc`, `sbom.json` and
  `!credentials.env.example`; `*.bak-*`/`*.tmp-*` covered since 1.4.4.
- **CI/Release with `timeout-minutes`:** jobs no longer inherit the 360 min default.
- **`tests/test_helper.js` also compares size:** content changes with the same mtime are
  now detected.

### Tests

- +3 tests: pinned lookup (M1), `SESSION_SECRET` failure/opt-out (M3) and Telegram UTF-16
  truncation; total **375**. Config tests updated for the new requirement and lockfile
  refresh test tolerant of the claim window (covered by the grace period).

## [1.4.4] - 2026-09-21

### Fixed

- **Phantom check-in in the report (`libs/report.js`):** `computeCheckinCoinsGained` fell
  back to the streak when `coinsGainedToday` was `'0'` (no collection), announcing
  "+40 coins" without check-in. A present non-positive value now returns 0; fallback only
  applies to absent/`N/D`. Affected unified report, multi-account, Telegram, webhook and
  `--json`.
- **Check-in counted without confirmation (`collect.js`):** `justCollected` was set after
  the click without checking the effect (swallowed `waitForSelector` timeout;
  `.e2e_normal_task_right_btn` always present as a false positive). Check-in is now counted
  only when the "today" marker appears; otherwise it logs a warning and does not increment
  streak/coins.
- **Balance truncated by thousands separator (`libs/ui/balance.js`):**
  `"My coins\n2.917"` became `"2"` and `"My coins\n12,345"` became `"12"`, contaminating
  balance, `initialBalance`/`finalBalance` and task earnings.
- **Check-in history crossed dates (`libs/ui/balance.js`):** the gap
  `[\s\S]{0,120}?` associated the next day's value with the previous date (false check-in
  and masked streak break). History is now processed in date blocks.
- **"Today" section used the first statement date (`libs/ui/balance.js`):** when today's
  spelling did not match, the document's first date was treated as today. It is now
  accepted only if it matches the current date (PT), tolerating leading zero.
- **Check-in label on the same line as the date became a "mission"
  (`libs/ui/balance.js`):** the anchored test (`^...$`) did not recognize
  `"21/09/2026 PT App daily check-in"`, zeroing the day's bonus.
- **Check-in value taken from any `aecoin-` element (`collect.js`):** the scan now filters
  visible elements, avoiding using the calendar's first `+N` as check-in credit.
- **Wrong task clicked (`libs/tasks/verifier.js`):** `findTaskElement` returned the old
  index element when the title was not found, executing the action on another task. It now
  returns `null` (the attempt is counted and the task is excluded after the limit).
- **Action counted without execution (`do_tasks.js`):** `totalActions` was incremented
  before locating element/button, consuming the global cap of 25 without executing
  anything. It now counts only when element and button are located (the attempt is still
  counted before, guaranteeing loop termination).
- **Reopening completed tasks (`do_tasks.js`):** `selectReopenableTasks` was called without
  `tasks`, reopening `isDone` titles. It now receives the last panel extraction.
- **Backoff held the account lock (`all.js`):** the wait of up to 30s happened before the
  `finally` that releases the lock, making another instance receive `LockActiveError`.
  Sleep now occurs after release.
- **`openDrawerBtn` clicked check-in (`libs/selectors.js`):** `#signButton` (check-in
  button) was in the "Earn more coins" panel opening list; removed (specific candidates and
  semantic fallback remain).
- **`closeModals` clicked out of context (`libs/ui/navigation.js`):** `[class*="close"]`
  could close a legitimate drawer/banner or trigger a generic "Confirm". It now clicks only
  visible elements inside a dialog/modal/overlay.
- **Slider always reported success (`libs/ui/navigation.js`):** `trySolveSlider` returned
  `true` even with the captcha on screen; it now returns `true` only if the track
  disappeared.
- **Dead/stale desktop cache (`libs/ui/balance.js`, `collect.js`):** the cached page is now
  validated (`isClosed`) and the cache is invalidated after a new login, avoiding silent
  `N/D` reads and old cookies.
- **Invented `+70 coins/day` (`libs/report.js`):** when the tier was unknown, the report
  displayed a fixed 70; it now shows `N/D`.

### Security

- **`sessionData` (cookies) out of `--json` stdout (`libs/report.js`):** storageState was
  printed in clear (going to `cron.log`/Docker logs) and allowed session hijacking. The
  value remains in the internal return but is not printed.
- **Multivalued `Cookie` redaction (`logger.js`):** `cookie: a=1; xman_us_t=SECRET; ...`
  only masked the first pair; the whole line is now redacted (including `set-cookie`).
- **Legacy migration does not destroy a valid `.enc` (`libs/session.js`):**
  `migrateLegacySession` overwrote an existing `session.json.enc` without backup; it now
  preserves it as `.bak-<ts>` and aborts if it cannot. The JSON error no longer interpolates
  file content.
- **Corrupted `session_meta.json` does not delete the session (`libs/session.js`):**
  unreadable meta was treated as an account mismatch and triggered `clearSession`; the
  session is now preserved.
- **Reinforced session permissions (`libs/session.js`, `export_session.js`):** existing
  `.enc`/plaintext/meta receive `0600` on load, and export chmods the `.enc` actually read
  (before it chmodded plaintext, which usually does not exist).
- **Session backups ignored by git/image (`.gitignore`, `.dockerignore`):** added
  `*.bak-*` and `*.tmp-*` (`*.bak` patterns did not match `session.json.enc.bak-<ts>`).
- **Stricter `isPrivateIp` (`libs/url_guard.js`):** 6to4 now extracts IPv4 from hextets 2-3
  (before it used the last 32 bits and allowed `2002:a9fe:a9fe::` → `169.254.169.254`),
  multicast `ff00::/8` and reserved IPv4 ranges (benchmark/TEST-NET) blocked, and IPv6
  canonicalized (`0:0:0:0:0:0:0:1` → loopback).
- **Sanitized multi-account error (`libs/notify.js`):** the individual failure message only
  passed through `escapeHtml`; it now goes through the query/header redactor, avoiding
  `?token=`/`code=` in Telegram.
- **Anti-TOCTOU lockfile (`lockfile.js`):** stale/orphan/invalid lock removal now moves to a
  private path and deletes only if the generation (`lockId`/`pid+createdAt`) still matches —
  before an unconditional `unlink` could destroy a lock just published by another process
  and allow two runs on the same account. Invalid `LOCK_STALE_TIMEOUT_MS`
  (`0`/negative/`NaN`) falls back to the safe default.
- **Multi-account: partial failure is no longer "success" (`all.js`):** with at least one
  OK account and another failing (error or 2FA), the process exited 0 and sent a `success`
  heartbeat, masking the failure in the dead man's switch. It now exits 1 with a failure
  heartbeat.

### Tests

- **Specific login/2FA selectors (`libs/selectors.js`, `libs/ui/login.js`, `collect.js`,
  `do_tasks.js`):** generic `input[type="text"]`/`input[type="email"]`/`input.cosmos-input`
  triggered false re-login with a valid session (and false expired-session alert); 2FA
  required only an input with "code" in name/class, causing false 2FA and cron/CI abort.
  Selectors are now specific and detection requires a **visible** input; login check is
  conditioned on the login/passport URL.
- **`skipWebhook` implemented (`libs/report.js`):** the option passed by tests was ignored
  and synthetic reports could be POSTed to the production webhook; it is now respected.
- **`cleanupIsolatedTestDir` allowlist (`tests/test_helper.js`):** recursive removal now
  requires a path under `os.tmpdir()`, avoiding deleting project files by mistake.
- **`docker-run.example.sh` validates `credentials.env`:** mounting a nonexistent file
  created a `root` directory on the host; it now fails with a clear message and creates
  `scratch/` first.
- **Dependabot does not auto-merge workflows
  (`.github/workflows/dependabot-automerge.yml`):** PRs changing `.github/workflows/**`
  require human review (supply chain).
- **Heartbeat does not slice JSON (`libs/heartbeat.js`):** a payload above the cap now
  becomes a plain-text summary instead of invalid truncated JSON.
- **Regression tests:** +8 tests (`'0'` accounting, check-in confirmation, relative dates,
  balance with separator, specific selectors, multivalued cookie,
  6to4/multicast/canonicalization, `skipWebhook`), total **372**.

## [1.4.3] - 2026-09-21

### Security

- **SSRF: guard can no longer be bypassed by redirect (`libs/url_guard.js`,
  `libs/report.js`, `libs/heartbeat.js`):** native `fetch` followed redirects
  (`redirect: 'follow'`), so a public destination could answer `302` to a private
  network/metadata (`169.254.169.254`) and the guard never saw the target. New `safeFetch`
  follows redirects manually, **revalidating each hop** with the same guard, with a hop
  limit and no credential propagation across origins. Webhook and heartbeat now use it.
- **SSRF: DNS fails closed (`libs/url_guard.js`):** when the hostname does not resolve, the
  destination is now **blocked** (before, resolution failure was tolerated, allowing a
  hostname to resolve only at fetch time). DNS timeout added.
- **SSRF: special IPv6 blocked (`libs/url_guard.js`):** link-local via `fe80::/10` (before
  only literal `fe80`), site-local `fec0::/10`, and prefixes that **embed IPv4** — NAT64
  `64:ff9b::/96`, 6to4 `2002::/16` and Teredo `2001::/32` (on a DNS64 network,
  `[64:ff9b::a9fe:a9fe]` reaches cloud metadata).
- **PII in webhook: masked phone/ID (`libs/report.js`):** sanitization only masked
  identifiers containing `@`; phone login was sent in clear to the external webhook. Any
  string in user context is now masked, and the raw object is **no longer returned** beyond
  the depth limit (previously leaked nested secrets).
- **`accounts.json`: `passwordEnv` no longer resolves inherited properties (`config.js`):**
  `passwordEnv: "constructor"`/`"toString"` resolved inherited functions as passwords; it
  now requires an own string property.
- **`accounts.json`: `passwordFile` confined to directory (`config.js`):** prevents path
  traversal (`../../etc/passwd`) and `chmod 0600` on arbitrary system files.
- **Artifact pruning confined to `scratch/` (`libs/session.js`):** retention policy deletes
  only inside the expected scratch; before, pointing `PW_OUTPUT_DIR` at user data silently
  deleted files.
- **Secrets redacted in Telegram/heartbeat (`libs/notify.js`, `libs/heartbeat.js`,
  `logger.js`):** error messages sent to external channels pass through the query/header
  redactor (`?token=`, `code=`, `Bearer`, `authorization:`/`cookie:`) and the heartbeat
  body gained a 32 KB cap. Also fixed HTML injection in the broken-streak alert (values now
  go through `toSafeStreak`/`escapeHtml`).
- **Atomic write does not follow symlink (`security.js`):** the direct-write fallback (bind
  mount) now rejects/removes a destination symlink and opens with `O_NOFOLLOW`, and
  `safeChmod600` does not change a link target's permission — prevents writing a session to
  an arbitrary file via a planted link.
- **Legacy migration does not overwrite a valid `.enc` and verifies roundtrip
  (`libs/session.js`):** if `session.json.enc` exists, it is preserved as backup before
  migration; the newly written `.enc` is **decrypted and rechecked** before deleting the
  only plaintext `session.json`.
- **Session mutations serialized per path (`libs/session.js`):**
  `saveSession`/`clearSession`/`updateSessionStreak` use a per-path mutex, eliminating the
  race where a `clear` deleted a file just written by a `save` in the same process.
- **Constant-time secret comparison in rotation (`libs/session.js`):**
  `oldSecret === newSecret` replaced with `crypto.timingSafeEqual`.
- **Expanded logger secret redaction (`logger.js`):** keys
  `pass`/`pwd`/`accessKey`/`private_key`/`bearer`/`senha`; redactor covers fragment
  (`#token=`), `Bearer` and `authorization:`/`cookie:`; preserves shared references (does
  not treat reuse as circular) and keeps `Error` `stack`/`type`.
- **PII masked in rotation log (`export_session.js`):** the aggregate summary uses
  `maskUser`.
- **Discord injection neutralized (`libs/report.js`):** mentions
  (`@everyone`/`@here`/`@&`) and markdown in scraped values are escaped; webhook cap
  measured in **bytes** (`Buffer.byteLength`), not code units.
- **Storage pruning: non-array `localStorage` treated as empty
  (`libs/storage_filter.js`):** prevents a malformed entry from escaping the allowlist.
- **Reports in business timezone (`time_utils.js`):** `formatDate`/`formatTime` use
  `America/Los_Angeles` (configurable via `REPORT_TIMEZONE`), avoiding day-rollover
  divergence on UTC VPS.
- **`--from-file` with cap and timeout (`import_session.js`):** limits to 2 MB, requires a
  regular file and applies a timeout (before a FIFO hung the process).
- **`crash.js` guarantees exit code 6:** the emergency timer is no longer `unref()`,
  avoiding exit 0 on crash.
- **Proxy credentials without scheme removed (`browser.js`):** `user:pass@host` is also
  sanitized before going to Chromium.

### Tests

- New regression tests: special IPv6 prefixes, fail-closed DNS, `safeFetch` blocking
  redirects to private network, phone masking in webhook, sanitizer depth,
  `passwordEnv`/`passwordFile`, pruning scope, redaction/escaping in Telegram, symlink on
  write/chmod, session mutex, migration backup/roundtrip, constant time in rotation,
  sensitive logger keys, non-array storage, Discord mentions, report timezone, `crash.js`
  and proxy without scheme — **364/364**.

## [1.4.2] - 2026-09-21

### Fixed

- **Webhook no longer leaks the session or PII (`libs/report.js`):** sending to external
  webhooks passes through sanitization (defense in depth) that **removes
  `sessionData`/`cookies`/`storageState`** and masks e-mails in user fields. Before, the
  check-in report in `--json` sent AliExpress authentication cookies to the webhook. Local
  `stdout` keeps the raw value (compatibility).
- **Raw e-mail in unified webhook (`libs/report.js`):** the unified report masks the user
  before external sending.
- **Direct write on bind mount no longer corrupts the session (`security.js`):** the
  fallback (when `rename` fails with `EBUSY`) creates a `.bak-<ts>` backup, performs a
  complete write (loop over `bytesWritten`) and restores the backup on failure, avoiding an
  empty/partial session if the process is killed (OOM) during write.
- **scrypt considers the cgroup limit (`security.js`):** `getEffectiveDefaultScryptN` uses
  `min(os.totalmem(), limit)` reading `/sys/fs/cgroup/memory.max` (v2) and
  `memory.limit_in_bytes` (v1), avoiding a ~128 MB peak in a container with reduced
  `--memory`.
- **Lockfile renewal no longer overwrites another lock (`lockfile.js`):** periodic refresh
  uses the same atomic-conditional pattern as `release` (rename to private path, check
  `lockId`/`pid`, only then rewrite and return). Eliminates the TOCTOU where a stale
  takeover between read and write "resurrected" the old lock and overwrote the new owner's
  lock, allowing concurrent execution.
- **Heartbeat SSRF considers DNS (`libs/heartbeat.js`):** `validateExternalUrl` now resolves
  the hostname, blocking destinations that resolve to loopback/private IPs (e.g. internal
  metadata via DNS). Opt-in `ALLOW_PRIVATE_WEBHOOKS=true` remains for private destinations.
- **Webhook revalidates destination before send (`libs/report.js`):** a second validation
  immediately before `fetch`, reducing the DNS rebinding window between validation and
  send.
- **History recognizes all check-in labels (`libs/ui/balance.js`):** desktop history streak
  calculation uses the same label pattern as the statement (includes
  "Daily bonus"/"Bônus diário"), which were not counted before.
- **Date-format detection no longer confuses label with locale
  (`libs/ui/balance.js`):** the month/day heuristic no longer uses "App daily check-in" (an
  English label even in pt-BR UI) as a locale signal, comparing real interface headers
  ("Minhas moedas" vs "My coins") and today's date.
- **Thousands-separator values are counted (`libs/ui/balance.js`):** the statement parser
  accepts `+1.000`/`+2,500`, rebuilding the value correctly instead of truncating it.
- **Telegram retry cancels the body and respects `retry_after` (`libs/notify.js`):** on 429
  the body is cancelled (frees the socket) and the wait follows the server-provided
  `retry_after` (30s cap), avoiding bursts that worsen rate limiting.
- **Safe message truncation (`libs/notify.js`):** truncation is by code points (does not
  split emojis/surrogate pairs) and removes unclosed HTML tags, avoiding Telegram `HTTP 400`
  for invalid entities.
- **Plaintext session requires explicit opt-out (`libs/session.js`):** with
  `ENCRYPT_LOCAL_SESSION` active (default) and `SESSION_SECRET` missing/short, writing is
  **refused** with `logger.error` (before it wrote plaintext with only a `warn`). To allow
  plaintext, use `ENCRYPT_LOCAL_SESSION=false`.
- **Chromium environment without secrets or proxy credentials (`browser.js`):** the
  sensitive key list covers `PASS`/`PWD`/`PRIVATE_KEY` and userinfo embedded in
  `HTTP(S)_PROXY`/`ALL_PROXY` is removed before passing to the browser.
- **Heartbeat action URL preserves query string (`libs/heartbeat.js`):**
  `buildActionUrl` inserts the `start`/`fail` segment before the query (e.g.
  `.../uuid?k=v` → `.../uuid/start?k=v`), instead of appending after it.
- **Unified legacy session migration (`libs/session.js`, `import_session.js`):** the two
  `migrateLegacySession` implementations were unified into one canonical function in
  `libs/session.js`. The CLI delegates in strict mode (throws
  `SessionMigrationError`→`ImportSessionError`, validates the schema and returns
  `cookiesCount`/`encrypted`), while the library keeps the tolerant contract
  (`{ migrated: false }` without throwing). Eliminates behavior divergence between flows.

### Security

- **SSRF: private/loopback IPv6 literal now blocked (`libs/url_guard.js`):**
  `validateExternalUrl` let **any** IPv6 literal through (e.g. `http://[::1]/`, `[fd00::1]`,
  `[fe80::1]`, `[::ffff:7f00:1]` = `127.0.0.1` and `[::ffff:a9fe:a9fe]` =
  `169.254.169.254`/cloud metadata), nullifying the control introduced in 1.4.0 for
  `NOTIFY_WEBHOOK_URL`/`HEARTBEAT_URL`. Two causes: (1) `URL.hostname` returns IPv6 in
  brackets, so `net.isIP` returned 0 and the host fell into the DNS branch, whose failure
  was tolerated (`ok: true`); (2) the classifier only recognized IPv4 mapped in decimal
  form, but `new URL()` normalizes to hexadecimal. Fixed by removing brackets/trailing dot
  from the hostname and decoding mapped/compatible IPv4 in hex.
- **Least privilege in release workflow (`.github/workflows/release.yml`):** global
  permission becomes `contents: read`, elevating to `contents: write` only in the job that
  publishes the release.
- **Cron container hardening (`docker-run.example.sh`):** `--cap-drop=ALL` and
  `--security-opt=no-new-privileges`, plus simple `cron.log` rotation (5 MB, configurable
  via `ALI_COINS_LOG_MAX_BYTES`) to avoid unbounded growth on a small VPS.

### Tests

- New tests for webhook sanitization (no `sessionData`/PII), backup fallback, cgroup,
  `buildActionUrl`/`normalizeBaseUrl`, thousands separator in statement, "Daily bonus"
  recognition in history, safe message truncation, Chromium environment sanitization,
  migration contract parity (strict CLI vs tolerant library) and private IPv6 literal SSRF
  blocking — **342/342**.

## [1.4.1] - 2026-09-21

### Fixed

- **Statement accounting faithful to the site (`libs/ui/balance.js`, `collect.js`,
  `libs/report.js`, `all.js`):** the desktop statement parser now sums **all** non-check-in
  credits of the day as task earnings (before `Widget coins` was ignored — tasks reported
  66 instead of 71), and the **real check-in of the day** is counted even when it was
  already marked collected (e.g. done by the user in the app), using TODAY's statement
  section as the source of truth. The notification event also considers that credit as a
  new action.

### Tests

- New case with the real VM statement (Widget coins) and `computeCheckinCoinsGained` with
  `checkinCoinsFromLedger` — **328/328**.

## [1.4.0] - 2026-09-21

### Security

- **SSRF blocking for external destinations (`libs/url_guard.js`):** webhooks
  (`NOTIFY_WEBHOOK_URL`) and heartbeat (`HEARTBEAT_URL`) validate the destination and
  **block loopback/private networks/link-local/metadata** (`127.0.0.1`, `10.x`,
  `172.16-31.x`, `192.168.x`, `169.254.169.254`, `::1`, `fc00::/7` etc.). Hostnames are
  resolved to prevent a public domain from pointing to a private IP (DNS rebinding).
  Opt-in for local tests: `ALLOW_PRIVATE_WEBHOOKS=true`.
- **Webhook payload cap:** bodies above 32 KB are replaced by a truncated summary
  (`{ truncated: true, originalSize, summary }`), protecting memory and destinations in
  large multi-account runs.
- **Passwords out of `accounts.json` (`config.js`):** each account can use `passwordEnv`
  (environment variable name) or `passwordFile` (`0600` file, relative to `accounts.json`)
  instead of plaintext `password`, reducing credential exposure in backups/sync. Inline
  `password` remains supported (backward compatible).

### Tests

- New tests for `libs/url_guard.js` (private/public IP, opt-in, protocols and hostnames),
  webhook/heartbeat SSRF blocking, payload truncation and `passwordEnv`/`passwordFile` —
  **326/326**.

## [1.3.4] - 2026-09-21

### Fixed

- **Real check-in value ("Daily bonus") and real task earnings ("Coin missions")
  (`libs/ui/balance.js`, `collect.js`, `do_tasks.js`, `libs/report.js`):** the desktop
  statement is now the **source of truth** for amounts actually credited:
  - `getBalanceDesktop` extracts `todayBonusCoins` (**Daily bonus** /
    **Bônus diário**) and `todayMissionsCoins`/`todayMissionsCount` (**Coin missions** /
    **Missões de moedas**) from today's bilingual section.
  - Check-in value prioritizes the **real statement value** over the streak-tier estimate
    (the site sometimes promises 40 and credits 1); divergences are logged at `warn`.
  - Task earnings become the **sum of "Coin missions"** in the statement, not the balance
    difference — which absorbed check-in credit and inflated task value (e.g. `+96`
    instead of `+56`).
  - `computeTasksCoinsGained` respects `coinsFromLedger` and does not subtract check-in
    when the value already comes isolated from the statement.
- **Check-in recognized by the new label:** the day's check-in is considered done also when
  the statement has **"Daily bonus"** (before only `App daily check-in`).

### Tests

- `extractTodayLedger` (pt/en), `getBalanceDesktop` exposing statement fields and
  `coinsFromLedger` in the report — **317/317**.

## [1.3.3] - 2026-09-19

### Added

- **App version in log and notifications:** the version (`package.json`) is displayed:
  - **Per-account log:** `[Version] ali-coins vX.Y.Z` at the start of each check-in/tasks
    run (`collect.js`, `do_tasks.js`) and suffix `(version vX.Y.Z)` on each account start
    line in multi-account (`all.js`).
  - **Telegram notification:** all messages display the host as `host (vX.Y.Z)`.

## [1.3.2] - 2026-09-19

### Added

- **Configurable second pass (`TASK_RETRY_UNFINISHED`, default `false`):** enables extra
  passes focused **only** on tasks that collected no round/failed for no progress. At the
  end of the normal pass, exhausted and still incomplete tasks are reopened
  (attempts/rounds reset) and reprocessed — without repeating completed tasks or tasks
  disabled for requiring the app. Controlled by `TASK_RETRY_PASSES` (number of passes,
  default `1`) and `TASK_RETRY_DELAY_MS` (wait between passes, default `5000`). Respects
  the global `TASK_MAX_ACTIONS` cap, does not repeat claims and is bounded (no infinite
  loop).
  - New pure function `selectReopenableTasks()` (`libs/tasks/state.js`) defines which tasks
    can be reopened (excludes `APP_ONLY_DISABLED_STATUS` and `isDone`).
  - Documented in `credentials.env.example`.

## [1.3.1] - 2026-09-19

### Added

- **`DESKTOP_REUSE_CONTEXT` (default `false`):** allows sharing a single desktop
  `BrowserContext` (`mycoin`) per account for balance/streak reads, instead of
  creating/closing a context per read. **Off by default**: VM measurement showed that
  keeping the desktop context alive during the mobile flow **raises** peak RAM/PIDs
  (concurrent contexts), which is worse on a 1 GB host. Available for hosts with memory
  headroom. The context is always closed at the end of each account (does not leak cookies
  between accounts).

## [1.3.0] - 2026-09-19

### Added

- **`TELEGRAM_PER_ACCOUNT` (default `false`):** makes the individual notification for each
  account **optional** in addition to the consolidated report. By default it remains
  **off**, preserving anti-burst behavior (when all accounts use the same chat, only the
  consolidated message is sent). Enable with `TELEGRAM_PER_ACCOUNT=true` in
  `credentials.env` to receive each account's detail separately.
  - The **consolidated report is always sent**, regardless of the flag.
  - The flag is validated by the Zod schema (boolean), shown in the `--dry-run` summary and
    documented in `credentials.env.example`.
  - `shouldSkipAccountNotification()` now receives `{ perAccountEnabled }`: with the flag
    on it never suppresses the individual message; off, it keeps duplicate-chat
    suppression.

## [1.2.2] - 2026-09-19

### Fixed

- **Check-in counted in task statement (`collect.js`, `libs/report.js`):** the check-in
  amount is no longer added to task earnings. `collect.js` stops inflating the base balance
  and only syncs it when the desktop ledger is **stale** (did not reflect the credit),
  ensuring the balance used as tasks' `initialBalance` already contains check-in. Thus
  `computeTasksCoinsGained` reports strictly task earnings, while check-in is counted
  separately by `computeCheckinCoinsGained`.
- **Check-in counted only when it has not occurred that day (`libs/report.js`):**
  `computeCheckinCoinsGained` returns 0 when `alreadyCollected === true`; on same-day runs
  the statement shows `check-in +0` and only tasks.
- **Deterministic streak increment (`collect.js`, `libs/report.js`):** new pure function
  `resolveStreakDays()` centralizes the logic (previously inline and divergent). Guarantees
  `+1` when checking in that day, uses `previousStreakDays` **or** the desktop read as base
  (the larger), preserves the consolidated streak on re-run and avoids regression from a
  spurious weekly cycle. Works the same in single and multi-account (same function).

### Tests

- New tests for check-in accounting isolation
  (`computeTasksCoinsGained`/`buildUnifiedReportPayload`/`buildMultiAccountReportPayload`),
  credited/stale balance scenarios and `resolveStreakDays` (increment, desktop base,
  re-run, weekly cycle, first run) — **306/306**.

## [1.2.1] - 2026-09-19

### Fixed

- **Telegram notifications lost to timeout (`libs/notify.js`):** `sendTelegram` now
  **retries with exponential backoff + jitter** (up to 3 attempts) for transient
  network/timeout/HTTP 5xx/429 failures; 4xx errors remain non-retryable. Default timeout
  per attempt increased from 5000ms to **15000ms** (`config.js`,
  `credentials.env.example`), avoiding drops on VPS with slow DNS/TLS.
- **Message burst in the same chat (`all.js`):** when an account's `telegramChatId` equals
  the global `TELEGRAM_CHAT_ID`, that account's individual message is suppressed (the
  consolidated message already covers the same destination); remaining sends are spaced by
  ~3s (`NOTIFY_MIN_SPACING_MS`) to avoid competing for Telegram's rate limit.
- **`Browse surprise items` without site confirmation (`libs/tasks/surprise.js`):** new
  best-effort fallback (`SURPRISE_DETAIL_FALLBACK`, default on) that, when feed clicks do
  not navigate, opens **one untapped card in detail** (new tab or `goBack` return) to try
  to count the round. Conservative: only runs with a real `context`, confirmed feed, no
  prior navigation and respects `AbortSignal`.

### Tests

- New tests for Telegram retry (`postToTelegramWithRetry`), duplicate-chat suppression
  (`shouldSkipAccountNotification`) and surprise detail fallback — **301/301**.
- VM validation: real run with retry triggered (attempt 1 `fetch failed` → success on 2),
  **one** consolidated Telegram notification, 2/2 accounts, 0 risks, 512MiB peak.

## [1.2.0] - 2026-09-18

### Fixed

- **Non-deterministic exit code in `export_session.js --all` (`export_session.js:410`):**
  missing `return` after `flushAndExit(1)` when there were no active sessions, and the flow
  still called `flushAndExit(0)` — exit code depended on the race between the two
  `process.exit` calls.
- **Config error in `--dry-run` became a crash (`collect.js`, `do_tasks.js`):** the main
  IIFE had no `.catch`, so a `ConfigValidationError` thrown by `handleDryRun()` escalated
  to the crash handler and exited with code 6; it is now treated as critical execution
  failure (exit 1).
- **Lock removed from a live process under `EPERM` (`lockfile.js`):** `isProcessAlive`
  treated `EPERM` ("no permission to signal" = process exists) as dead, potentially
  removing another legitimate instance's lock; `EPERM` is now considered alive.
- **`customMessage` without escaping in Telegram (`libs/notify.js`):** custom messages sent
  with `parse_mode: HTML` did not pass through `escapeHtml`.
- **Orphan lock with invalid config (`all.js`):** `loadConfig(true)` now runs **before**
  `acquireLock`, so invalid config exits 1 without leaving a stuck lock.
- **Silent lock refresh (`lockfile.js`):** failures renewing `createdAt` now emit
  `logger.warn` (without blocking the run), avoiding an active lock being considered stale
  by another instance without any signal.
- **Webhooks could be lost on shutdown (`libs/report.js`, `libs/exit.js`):**
  fire-and-forget notifications are tracked and awaited (5s cap) before `process.exit`.
- **Orphan tabs/popups during tasks (`do_tasks.js`):** tabs opened by tasks are closed after
  each action and the `context.on('page')` listener is removed at the end.
- **Orphan desktop context on setup failure (`browser.js`):**
  `newMobileContext`/`newDesktopContext` close the `BrowserContext` if
  `addInitScript`/routes/tracing fail after `newContext`.
- **Unbounded/no-timeout STDIN import (`import_session.js`):** pipe token reading now has a
  2 MB cap and 60s inactivity timeout, avoiding OOM/hang with infinite input.
- **Inverted session/meta order on import (`import_session.js`):** metadata is now written
  **before** the session, like `saveSession`, avoiding an orphan `.enc` without meta.
- **Inflated "Tasks executed" count (`libs/report.js`):** uses `totalActions` (real
  actions) instead of `results.length` (includes skipped/disabled tasks), with a compatible
  fallback.
- **Invisible task-stage failure in the report (`all.js`, `libs/report.js`):**
  `tasksError` is now propagated in the report `meta` (without changing exit codes).
- **Stream flush without observability (`libs/exit.js`):** `flushStream` signals timeout
  and shutdown logs a warning when output may have been truncated.
- **Token with malformed buffers (`security.js`):** `parseSessionToken` validates canonical
  iv/tag/salt sizes and rejects early (same public authentication message).
- **`formatDuration`/backoff with non-finite values (`time_utils.js`):**
  `Number.isFinite` avoids `NaN`/`Infinity` output.
- **Generic lock failure became "lock active" (`all.js`):** multi-account flow now
  distinguishes active lock (exit 3) from generic `acquireLock` error (exit 1), counting
  each case instead of one flag.
- **Meta/session pair could approve another account's session (`libs/session.js`,
  `import_session.js`):** the session is now written **before** meta; on a crash between
  writes the pair is new-session + old-meta, which `validateSession` rejects due to account
  mismatch (safe re-login).
- **Invisible task failure in multi-account (`all.js`, `libs/report.js`):** `tasksError` is
  now propagated per account (item and `meta`) in the multi-account report, keeping fields
  optional.
- **Missing exit 5 (2FA) in standalone entrypoints (`collect.js`, `do_tasks.js`):**
  `node collect.js`/`node do_tasks.js` now exit with code 5 on non-interactive 2FA, aligned
  with `all.js`.
- **Webhook flush could fail to wait (`libs/webhooks.js`):** removed `unref()` from the
  flush timer; shutdown waits for the short cap.
- **Crash handler truncated the flush (`libs/crash.js`):** emergency timer increased from
  5s to 15s, avoiding cutting fatal log/report mid-flush (webhooks + streams).

### Security

- **`accounts.json` with unrestricted plaintext credentials (`config.js`):** the file now
  receives `chmod 0600` at runtime, with a warning when it was readable by other users.
- **`credentials.env` without runtime permission reinforcement (`config.js`):** `chmod
0600` applied at boot, covering manually created files outside the installer.
- **Dry-run exposing sensitive data (`config.js`):** Telegram Chat ID is now masked and
  `SESSION_SECRET`/password/token lengths were removed from output (only `[SET]`).
- **Secrets could reach Chromium (`browser.js`):** `options.env` is now merged over the
  sanitized env instead of replacing it.
- **Decryption error message leaked internal detail (`security.js`):** detail goes only to
  `logger.debug`; the public prefix remains stable.
- **Plaintext session without warning (`libs/session.js`):** when
  `ENCRYPT_LOCAL_SESSION` is active without a valid `SESSION_SECRET`, an explicit warning
  is emitted.
- **Persisted/injected telemetry localStorage (`libs/storage_filter.js`,
  `libs/session.js`):** allowlist shared with `export_session` filters telemetry keys
  (hundreds of KB) in `saveSession`, preserving authentication cookies; opt-out
  `SESSION_STRICT_STORAGE=false`.

### Performance

- **`pino-pretty` avoided outside a TTY (`logger.js`):** color mode (which starts a pino
  worker thread) is only used in an interactive terminal; in cron/systemd without a TTY
  logs are structured JSON, saving CPU/RAM.
- **Consolidated `closeModals` (`libs/ui/navigation.js`):** CSS selectors resolved in one
  `evaluate` (before up to 8 `page.$` + 300ms sleeps per call); Playwright `:has-text`
  selectors remain supported, with fallback for mocks/environments without `evaluate`.
- **Compact JSON payloads (`libs/heartbeat.js`, `libs/session.js`):** heartbeat and
  metadata/session no longer use `JSON.stringify(..., null, 2)`, reducing bytes
  transferred/stored.
- **scrypt auto-sized by RAM (`security.js`):** on a host with ≤1.5 GB total RAM, new
  encryptions use `N=2^15` (~32 MB peak instead of ~128 MB); explicit `SCRYPT_N` still has
  precedence and existing tokens are unaffected.
- **`findTaskElement` with a single `$$eval` (`libs/tasks/verifier.js`):** resolves the task
  index in one CDP roundtrip, eliminating N+1 `$eval`; fallback to the old path is kept.
- **`config` propagated to `runCheckin`/`runTasks` (`all.js`):** avoids Zod/Commander
  re-parsing per account in multi-account.
- **Optional `fsync` on metadata (`security.js`, `libs/session.js`, `import_session.js`):**
  `safeWriteFile(..., { durable: false })` skips fsync on disposable metadata, preserving
  atomic writing.
- **Optional desktop context reuse (`libs/ui/balance.js`):**
  `options.context`/`options.reuseContext` + `closeCachedDesktopContext()`; **off by
  default** to avoid keeping a live context and raising peak RAM during the mobile flow.
- **Webhooks in a lightweight module (`libs/webhooks.js`):** `libs/exit.js` no longer loads
  Playwright (via `report.js`) on every exit, reducing latency/memory for `import_session`,
  `export_session`, `--help` and `--dry-run`.

### Wave 5 (final hardening)

- **Card revalidation in `findTaskElement` (`libs/tasks/verifier.js`):** the `$$eval`
  optimized path revalidates the resolved element's title before returning, avoiding
  clicking another card if the list re-renders between the two queries.
- **Prize Land cancellation (`libs/tasks/prizeland.js`, `libs/tasks/dispatcher.js`):**
  `AbortSignal` is now propagated and the click is aborted if the task times out.
- **Desktop context cache closed on teardown (`collect.js`, `do_tasks.js`,
  `libs/ui/balance.js`):** `closeCachedDesktopContext()` is called at the end, avoiding
  retaining RAM/cookies between accounts when opt-in reuse is active.
- **`export_session` with explicit path (`export_session.js`):**
  `options.sessionPath`/`sessionMetaPath` take precedence over paths derived from
  `--account`.
- **Null-safe `accounts.json`/storage filtering (`export_session.js`):** reuses
  `filterStorageState`, eliminating `TypeError` with `null` entries and divergence with
  `libs/storage_filter.js`.
- **`libs/crash.js`:** non-`Error` crash reason is serialized (not `[object Object]`).
- **`security.js`:** best-effort directory `fsync` after rename (rename durability) and
  scrypt memory pre-check (`128*N*r*p + 128*r*p`) preventing a clamped `maxmem` from
  causing "memory limit exceeded".
- **`config.js`:** secondary account locks follow `baseDir` (before they ignored a custom
  baseDir); primary keeps the global lock.
- **`.dockerignore`:** excludes `libs/extracted/` (local libs must not override apt libs in
  the container).
- **Token format labels (`export_session.js`, `import_session.js`, `libs/session.js`):**
  texts use `AES-256-GCM`/`v3` instead of "v2".
- **`--account` no longer generates a false positional-argument warning
  (`import_session.js`).**
- **`dependabot-automerge.yml`:** trigger moved to `pull_request_target` (no checkout/run
  of PR code), avoiding 403 from the downgraded `GITHUB_TOKEN` on Dependabot PRs.

### Added

- **`SESSION_STRICT_STORAGE`** (default `true`), **auto `SCRYPT_N`**, **`options.durable`**
  in `safeWriteFile`, **`options.context`/`options.reuseContext`/
  `closeCachedDesktopContext()`** in `getBalanceDesktop`, **`flushWebhooks()`**,
  **`tasksError`** in the unified report `meta`, and export of
  `isProcessAlive`/`getEffectiveDefaultScryptN`.

### Tests

- New/extended coverage in `tests/navigation.test.js`, `tests/lockfile.test.js`,
  `tests/logger.test.js`, `tests/config.test.js`, `tests/multi_account.test.js`,
  `tests/notify.test.js`, `tests/heartbeat.test.js`, `tests/exit.test.js`,
  `tests/security.test.js`, `tests/session.test.js`, `tests/tasks.test.js`,
  `tests/balance.test.js`, `tests/report.test.js`, `tests/time_utils.test.js`,
  `tests/import_stdin.test.js`, `tests/webhooks.test.js` and
  `tests/dockerignore.test.js` — **296/296**; `actionlint` with no workflow errors.
- VM validation (rebuilt container): `exit=2` (2nd run of the day without action), ~5m30s,
  peak **~520MiB**, 2/2 accounts, 0 risks; 1024 MB host auto-detected for scrypt
  `N=32768`; storage filter kept only allowed keys; `libs/webhooks.js` does not load
  Playwright.

## [1.1.0] - 2026-09-18

### Added

- **`SKIP_APP_ONLY_TASKS` (default `true`):** new flag that disables verification of tasks
  requiring the native AliExpress app and never completing via web — Prize Land/Magic Farm
  (watering), minigames (e.g. "Complete 1 Merge Boss game order"), quizzes ("Daily quiz
  challenge") and order reviews ("review"/"avalia"). When on, these tasks are skipped in
  the loop **without consuming attempts/actions**, and appear in the final report as
  `Disabled (app-only tasks disabled)`. A warning is emitted at stage start and another per
  skipped task. Set `SKIP_APP_ONLY_TASKS=false` in `credentials.env` to restore previous
  behavior (try all tasks). Documented in `credentials.env.example` and shown in the
  `--dry-run` summary.

### Notes

- Default behavior change: because it is compatible with the bot flow (it only stops
  insisting on tasks impossible via web), the version is minor (`1.1.0`).

## [1.0.2] - 2026-09-18

### Fixed

- **PII in tasks webhook (`libs/report.js`):** `renderTasksReport()` in `--json` mode now
  masks `userEmail` before dispatching to external webhooks, keeping the policy already
  applied to check-in and the raw value only on local `stdout`.
- **False "Sign in" positive with a valid session (`collect.js`, `do_tasks.js`):** textual
  login-screen signs (`Email or phone number`, `Sign in`, `Entrar`) are only considered
  when the URL confirms a login/passport page, avoiding unnecessary re-login (and 2FA risk)
  in footers/menus.
- **Case-insensitive account comparison (`security.js`, `libs/session.js`):**
  e-mails/IDs with different case no longer invalidate legitimate sessions.
- **Imported-session fallback in multi-account (`libs/notify.js`):** the fallback that
  reads primary `session_meta.json` is no longer applied to multi-account reports;
  per-account flags remain the source of truth.
- **Card click in "Browse surprise items" (`libs/tasks/surprise.js`):** a card is only
  marked as tapped when the click was actually dispatched (native or `evaluate` fallback);
  total click failures do not "burn" the card and allow a new attempt.
- **Container HEALTHCHECK (`Dockerfile`):** timeout increased to 30s and `--retries=5` to
  avoid marking `unhealthy` under CPU/RAM pressure during execution.
- **Stolen lock on long runs (`lockfile.js`):** `acquireLock()` now renews the lock
  `createdAt` periodically while the owner is alive (every `staleTimeout/3`, 5 min cap),
  preventing a run above 30 minutes from being treated as orphan and allowing two
  concurrent runs. Refresh is atomic and only renews if the generation (`lockId`) is still
  ours.
- **Old history streak (`libs/ui/balance.js`):** `getStreakFromDesktopHistory()` discards
  sequences whose most recent entry is not today/yesterday in the history timezone (PT),
  avoiding reporting an old streak as current and masking a real break when the mobile read
  returns `N/D`.
- **Release workflow (`release.yml`):** the release is preferably anchored to the tag
  without `v` (project default) when both exist, and creation gained an idempotent fallback
  for the race between `X.Y.Z` and `vX.Y.Z` tag runs.

### Performance

- **Playwright tracing off by default in low-memory mode
  (`libs/ui/diagnostics.js`):** `PW_TRACE`/`PW_SCREENSHOT`/`PW_VIDEO` options are resolved
  in one place, with tracing default `off` when `CHROMIUM_LOW_MEMORY` is enabled (default).
  Explicit env still takes precedence. Eliminates continuous screenshot/DOM snapshot
  writing on 1 GB hosts.
- **In-memory session is not decrypted twice (`libs/session.js`):**
  `validateAndRefresh()` now uses `skipSession` when receiving `existingSessionData`,
  avoiding a second scrypt (N=2^17) per account in the unified check-in → tasks flow
  without changing migration/rotation in the default path.
- **Failure screenshots viewport-only (`libs/ui/diagnostics.js`):** by default diagnostic
  screenshots no longer use `fullPage`, avoiding giant images and RAM spikes on infinite
  pages in the error path; the full document remains available with
  `PW_SCREENSHOT_FULL_PAGE=true`.
- **Service workers blocked and background flags in Chromium (`browser.js`):** contexts
  start with `serviceWorkers: 'block'` (opt-out `PW_BLOCK_SERVICE_WORKERS=false`) and
  Chromium receives CPU/network-saving flags (`--disable-background-networking`,
  `--disable-component-update`, `--disable-sync`, `--disable-breakpad`, `--mute-audio`,
  `--no-first-run`, `--disable-features=Translate,...`). BackForwardCache is preserved to
  keep surprise `goBack()` behavior.
- **Batched card signatures (`libs/tasks/surprise.js`):** all card signatures are obtained
  in one `$$eval` per query (with individual fallback), eliminating one CDP roundtrip per
  candidate card on each tap.
- **Removed `networkidle` (`collect.js`):** post-login waits no longer use `networkidle`
  (which could wait up to 30s for telemetry) and use `domcontentloaded` + a short wait,
  with stabilization guaranteed by explicit selector waits.
- **Async scrypt (`security.js`, `libs/session.js`):** new
  `encryptSessionAsync`/`decryptSessionAsync` variants are used in session flows, freeing
  the event loop during derivation (~200ms at default N) while Chromium is active; sync API
  and token format remain unchanged.
- **Logger fast path (`logger.js`):** flat records (no nested objects or sensitive keys)
  skip the recursive scrub/sanitization copy, keeping string and `err.message`
  sanitization.
- **Safe VM sync documentation (`CLOUD_SESSIONS.md`):** new method with `rsync` and anchored
  excludes, warning that patterns without `/` (e.g. `session*`) exclude `libs/session.js`
  and leave the VM running old code.

## [1.0.1] - 2026-09-18

### Fixed

- **Executed task count in multi-account report (`libs/report.js`):** fixed reference to
  the nonexistent `res.tasksResult.totalActions` field in `renderMultiAccountReport()`,
  which caused constant `"Tasks executed: 0"` even with completed tasks. The log now uses
  `res.tasksResult.results.length`, showing the correct number of processed tasks per
  account.
- **PII protection in check-in webhook in JSON mode (`libs/report.js`):** in
  `renderCheckinReport()` with `options.json = true`, the account e-mail now goes through
  `maskUser` before `sendWebhookNotification()`, preventing credential leakage to external
  webhooks (Discord/Telegram) and keeping the raw value only on local `stdout` for pipeline
  consumers.
- **Tab isolation, post-timeout recovery and self-healing in "Browse surprise items"
  (`libs/tasks/surprise.js`, `do_tasks.js`, `libs/tasks/verifier.js`):**
  - The new-tab capture fallback via `context.pages()` in `surprise.js` now stores a
    snapshot (`pagesBeforeClick`) before each tap and strictly filters pages opened
    _after_ the click. This eliminates accidental closing of the main execution page
    (`mainPage`) and the surprise feed page (`activePage`), which caused the catastrophic
    `page.$$eval: Target page, context or browser has been closed` error.
  - New self-healing routine `ensureMainPage` (`libs/tasks/verifier.js`, exported in
    `do_tasks.js` and `libs/ui/tasks.js`): detects whether the main page was closed or
    navigated away from the coin center, transparently recreating the page from the browser
    context and reopening the msite without interrupting the task loop.
  - The `context.on('page')` listener in `do_tasks.js` is registered after main page
    initialization and ignores recreations (`isRecreatingPage`), preventing the main page
    from being mistaken for a new tab and improperly closed after timeouts.
  - **Elimination of silent task-loop shutdown (Risk 1):** `extractTasksFromDrawer` now
    attaches `error` as a non-enumerable property to the return array on extraction
    failures (preserving strict equality in legacy tests) and supports `throwOnError`.
    Introduced `getDrawerTasksWithRetry`, which makes up to 2 attempts triggering
    `ensureMainPage` and reopening the panel on transient failures, ensuring the loop and
    final task statement are not prematurely aborted as empty.
- **Time budget, feed vs. ad differentiation and card repetition prevention in "Browse
  surprise items" (`libs/tasks/surprise.js`, `libs/tasks/dispatcher.js`, `do_tasks.js`):**
  - Optimized waits in `surprise.js` (selector wait 12s, pre-tap 200ms, `domcontentloaded`
    cap 3s, 1s dwell and post-tap 400ms), reducing time per tap to 3–6 seconds and
    completing the 3 actions well below the 180s budget.
  - **Precise feed vs. ad differentiation (Risk 2):** introduced `normalizeFeedUrl` to
    ignore volatile tracking parameters (`_immersiveMode`, `spm`, `aecmd`, `ts`, etc.).
    `isFeedUrl` now validates both normalized URL equality and physical presence of
    product cards in the DOM (`cardCount > 0`), and revalidates the base navigation URL
    after initial redirect.
  - **Elimination of card repetition by circular rotation (Risk 3):** replaced modulo
    index calculation with deterministic tracking of unique signatures
    (`getCardSignature`) via a `touchedCardsSet` persisted during the account run.
    Automation selects strictly new cards, scrolls the feed if needed and cleanly stops the
    round if all available cards have already been tapped, preventing unscored repeat taps.
- **Task dispatch in the UI facade (`libs/ui/tasks.js`):** fixed signature mismatch in
  `executeTaskAction` (which received 4 positional parameters in `libs/ui/tasks.js` while
  `do_tasks.js` passed a parameter object `{ page, context, task, config, signal }`). The
  facade now transparently forwards args via `...args` to
  `dispatcher.executeTaskAction` (and in `executeSurpriseItems`, `openTaskDrawer` and
  `extractTasksFromDrawer`), restoring "Browse surprise items" task identification (which
  improperly fell into the generic scroll fallback with empty title `""`), and guaranteeing
  `AbortSignal` propagation.
- **Navigation and ad return in "Browse surprise items" (`libs/tasks/surprise.js`):**
  fixed the boolean logic inversion (`!page.url().includes('adclick.html')`) that prevented
  returning via `page.goBack()` when a product card tap navigated the same tab to
  ad/redirect URLs (`adclick.html`). The flow now detects redirects to `adclick.html`, item
  pages (`/item/`, `/detail/`) or URLs leaving the feed, waits for tracking registration
  (1.5s), runs `page.goBack()` and, if history is stuck on `adclick.html`, forces
  `page.goto(feedUrl)`.
- **Resilient new-tab capture in low-memory environments
  (`libs/tasks/surprise.js`):** added a `context.pages()` fallback to capture and close
  child tabs when `context.waitForEvent('page')` times out due to latency or concurrency on
  restricted hosts (such as 1 GB RAM instances).
- **Streak increment (+1) on successful check-in (`collect.js`):** when check-in is
  performed today (`justCollected === true`), if the mobile/desktop AliExpress UI reports a
  spurious read (<= 7), missing or not yet updated by the DOM (<= `previousStreakDays`),
  the previous streak is safely incremented (`previousStreakDays + 1`), ensuring the streak
  is neither frozen on the previous day nor mistaken for a break. On same-day re-runs
  (`alreadyCollected === true`), the consolidated streak is preserved without repeated
  increment.
- **Check-in coin isolation in task statement (`collect.js`, `libs/report.js`,
  `libs/notify.js`):** fixed the 1.0.0 regression where the check-in amount was being added
  to the task statement total:
  1. `collect.js` syncs the post-check-in total balance (`totalBalance`) considering the
     received coins if the desktop page had not yet recorded the transaction at the time of
     the post-mobile check.
  2. `computeTasksCoinsGained` (`libs/report.js`) detects whether the tasks' initial
     balance corresponded to the pre-check-in balance and subtracts the check-in coins,
     ensuring the statement and task reports reflect strictly the coins earned by tasks in
     both single and multi-account.
  3. `libs/notify.js` prioritizes the centralized, validated calculation of
     `meta.tasksCoinsGained`, eliminating improper overwriting by raw deltas.
  4. New `getCheckinCoinsFromStreak` (`libs/ui/balance.js`) to infer the official
     AliExpress coin table from the streak day as a fallback when the desktop ledger comes
     temporarily as `N/D`, preventing a new check-in from counting zero coins.
- **Check-in accounting zeroed when already collected that day (`collect.js`,
  `libs/report.js`, `libs/notify.js`):** on same-day re-runs
  (`alreadyCollected === true`), the statement in console (`renderCheckinReport`,
  `renderUnifiedReport`, `renderMultiAccountReport`), webhooks and Telegram notifications
  explicitly report `check-in +0` / `Already collected (+0 coins)` and do not count phantom
  value in the daily total coins earned, fully preserving the task statement in both single
  and multi-account runs.

## [1.0.0] - 2026-09-17

> **Migration notes (0.9.x → 1.0.0):** the public contract is frozen — CLI and exit codes
> `0–6`, `session*.json(.enc)` format, `v3:N:r:p:...` tokens (with transparent `v1`/`v2`
> reading), environment variables and `--json` reports. Relevant behavior changes:
>
> - **Lockfile in the project directory** (`ali-coins-<uid>.lock`), no longer in `/tmp`;
>   native and Docker runs **do not share** the lock (avoid running them together).
> - **Low-memory Chromium flags active by default** (opt-out `CHROMIUM_LOW_MEMORY=false`;
>   heap adjustable via `CHROMIUM_JS_HEAP_MB`, 64–2048 MB). `--no-zygote` only applies with
>   sandbox disabled; there is an automatic sandbox fallback only when the error indicates
>   the sandbox is unavailable.
> - **Batch import removes `session_token*.txt` after success** — use `--keep-tokens` (or
>   `KEEP_SESSION_TOKENS=true`) to preserve them.
> - **Logs mask PII and secrets in query strings** (tokens/apikeys in URLs no longer appear
>   in clear in `cron.log`).
> - **`SCRYPT_N` with floor 16384 and ceiling 1048576**; parameters embedded in `v3`
>   tokens are sanitized on decryption.
> - **`PW_SCREENSHOT` is actually applied** (automatic capture on failure or always,
>   depending on configuration).
> - **Node.js >= 22** is required.
> - Existing sessions and tokens remain valid; key rotation now covers all accounts
>   (`export_session.js --rotate`).

### Fixed

- **Lockfile in a private project directory:** the lock (primary and secondary) moved from
  `/tmp` to the project directory, eliminating the DoS/tampering vector by other users
  (directory in the lock path, symlink or forged timestamp). If the path is occupied by a
  non-removable item, failure is now immediate and explicit (before it repeated 5 grace
  rounds until failing).
- **Lockfile release race (found in Windows CI):** the file gained a generation `lockId`
  and `release()` only removes the lock if the `lockId` is still ours, eliminating the
  window where a delayed release deleted another newly acquired instance's lock.
- **Transient lockfile I/O error treated as active lock:** read failures
  (`EBUSY`/`EPERM`/`EACCES`, common with antivirus/indexers on Windows) no longer remove
  the file; execution is delayed fail-safe (`LOCK_ACTIVE`). A directory in the path still
  fails fast and clearly.
- **Phantom check-in value in multi-account report
  (`buildMultiAccountReportPayload`):** `alreadyCollected: true` is respected again —
  `coinsGainedToday` is only informative echo of the completed check-in and no longer
  inflates `checkinCoinsGained`/`totalCoinsGained` in secondary-account notifications
  (same fix applied to the unified path in 0.9.1).
- **Centralized coin calculation:** `computeCheckinCoinsGained`,
  `computeTasksCoinsGained` and `computeFinalBalance` (`libs/report.js`) are the single
  source used by payloads and Telegram fallbacks (`libs/notify.js`), eliminating
  code-copy divergence. `computeTasksCoinsGained` ignores `NaN`/`Infinity` and
  `computeFinalBalance` returns `N/D` (instead of `"undefined coins"`) when balance was not
  read.
- **Multi-account `notify.js` without `meta`:** the local fallback also no longer counts
  check-in when `alreadyCollected` is true.
- **`setup_linux.sh`/`setup_macos.sh` no longer expose the generated `SESSION_SECRET` in
  `argv`** (visible via `ps`): the key is passed via environment variable to the Node
  process.
- **Signals propagated in run scripts:** `run.sh`/`run_tasks.sh` use `exec` and
  `run_all.sh` forwards `TERM`/`INT` to the child Node, avoiding orphan Node/Chromium on
  `kill`/systemd stop.
- **Shutdown never hangs on flush (`libs/exit.js`):** 5s cap for stdout/stderr and
  synchronous flush of the pino destination (`--json`).
- **Launch fallback does not disable the sandbox on generic failure:** the attempt without
  `--no-sandbox` only happens when the error indicates an unavailable sandbox/zygote;
  transient failures retry only without low-memory flags, preserving the sandbox. The final
  error preserves the original cause (1st attempt).
- **Secrets in URLs no longer leak in logs:** `maskHeartbeatUrl` masks a token in an
  intermediate path segment, clears embedded credentials (`user:pass@host`) and removes the
  fragment; the logger sanitizes **all string values** of structured fields (e.g. `{ url }`),
  not only `msg`/`err`.
- **PII with short local part:** `maskUser('a@b.co')` now returns `***@b.co` (before the
  whole e-mail leaked because the regex required 2 characters before `@`).
- **Unknown task button no longer treated as "Completed":** completion requires positive
  signals (disabled style or DONE/COMPLETED text); new labels (A/B test) remain
  `Manual verification required (button "X" not recognized)`, and reported progress
  (`statusText`, e.g. `1/3`) has priority in classification.
- **Textual `cover` heuristic removed from disabled-button detection:** a style with
  `background-size: cover` could mark an **active** task as completed; now only
  `opacity: 0.5` (and completed rounds/DONE text) indicate completion.
- **`decryptSession` reports invalid scrypt parameters as authentication failure:**
  `scryptSync` moved inside the protected block (with safe key cleanup).
- **`saveSession` writes metadata before the session:** a session write failure leaves no
  orphan metadata and no valid session discarded on the next cycle.
- **Automatic screenshot without duplication:** pages that already had a manual failure
  screenshot do not receive a duplicate automatic capture in
  `closeContextWithDiagnostics`.
- **`CHROMIUM_JS_HEAP_MB` clamped to `[64, 2048]` MB** — typos do not generate absurd flags.
- **Telegram:** `streakDays`, balance and durations now pass through `escapeHtml`.
- **Crash handler flushes logs** before `exit 6`.
- **`os.userInfo()` protected:** containers with `--user` and no `/etc/passwd` entry no
  longer break boot (treated as non-root).
- **Case-tolerant account export:** `expectedUser` and `meta.user` are compared without
  case sensitivity when they represent the same identifier.
- **`positiveInt` rejects non-numeric values** (e.g. `10abc` is no longer accepted as 10).
- **`PW_SCREENSHOT` functional:** automatic screenshot capture when closing a failed
  context (`only-on-failure`) or always (`on`) — before it was dead config.

### Added

- **Low-memory Chromium flags (default) and configurable `CHROMIUM_JS_HEAP_MB`:**
  `--disable-gpu`, `--disable-software-rasterizer`, `--renderer-process-limit=1`,
  `--js-flags=--max-old-space-size=128` (adjustable, invalid values revert to default) and
  `--disk-cache-size=10485760`; disable via `CHROMIUM_LOW_MEMORY=false`. `--no-zygote` only
  applies with sandbox disabled (Chromium requirement). Documented in
  `credentials.env.example`.
- **`Docker Build & Smoke` CI job:** image build, `.dockerignore` security pattern
  validation, `--dry-run` and `chrome-headless-shell` launch inside the container — catches
  Dockerfile/.dockerignore regressions before merge.
- **`files` allowlist in `package.json`:** avoids accidentally publishing
  session/credential files in a future `npm pack/publish`.
- **`docker-run.example.sh`:** recommended cron wrapper for small hosts, with `--init`,
  `--pids-limit=256`, `--memory`/`--memory-swap` limits (768m/1536m), log rotation and
  recording of each run's **real peak** memory/PIDs.
- **1 GB RAM host guide:** `README.md` and `CLOUD_SESSIONS.md` now recommend 1–2 GB swap,
  `SCRYPT_N=32768` (~33 MB peak instead of ~134 MB) and
  `--shm-size=256m --memory=768m --memory-swap=1536m` in `docker run`. The guide also
  documents that native and Docker runs **do not share the lockfile**.
- **Manually testable `Release` workflow:** `workflow_dispatch` with a `tag` input
  (checkout at the given ref), allowing rehearsing/republishing releases without creating a
  new tag.
- **New tests (226 total):** `.dockerignore`, `PW_SCREENSHOT` (dedupe), progressive fallback
  (sandbox and memory), generic failure without disabling sandbox, configurable heap with
  clamp and error with `cause`, secrets in URL/query string (logger and heartbeat,
  including token in the middle of the path and credentials), Telegram escaping,
  crash/flush, strict `positiveInt`, case-insensitive `exportSession`, fast lock failure in
  directory, release by `lockId` and fail-safe I/O, DONE label vs. unknown button,
  `statusText` priority, `cover` style not completing a task, metadata before session,
  compact token with high `SCRYPT_N`, phantom check-in value in all three paths, `maskUser`
  with short local part and missing/`N/D` balance.

### Changed

- **Leaner, lighter Docker image:** installs only `chrome-headless-shell`
  (`playwright install --only-shell chromium`, ~390 MB less, since the image always runs
  headless), removes `curl` from runtime, cleans the npm cache in the same layer and sets
  `NODE_OPTIONS=--max-old-space-size=192` (more aggressive GC on 1 GB hosts).
- **Reduced build context (`.dockerignore`):** `tests/`, Windows files (`*.bat`, `*.ps1`,
  `setup_windows.*`, `generate_secret.*`), extensive documentation (`INSTALL_*.md`,
  `TELEGRAM.md`, `README.md`, `CLOUD_SESSIONS.md` etc.), dev/CI tools (`.github/`,
  `.husky/`, `eslint.config.js`) stay out of the image — keeping all security exclusions
  for sessions/credentials/tokens.
- **HEALTHCHECK every 5 minutes** (before 30s): avoids ~2,600 unnecessary daily Node
  process runs for a job that runs once/day.
- **`PW_TRACE=off` recommendation on tight hosts** documented in
  `credentials.env.example` (manual failure screenshots remain active).

## [0.9.7] - 2026-09-17

### Fixed

- **Multi-account rotation isolated by `baseDir` (`rotateAllSessions`):** secondary account
  rotation backups are written to the target directory's `scratch/` (e.g. test project
  directory), never the project's real `scratch/`. Regression covered by a test comparing
  the real scratch listing before/after.
- **Windows compatibility of the Chromium env test:** the `PATH` preservation assertion now
  compares case-insensitively (Windows exposes `Path`), keeping validation that sensitive
  variables are not propagated.
- **Lockfile anti-DoS by forged timestamp:** locks with a future `createdAt` (beyond 5 min
  skew tolerance) or invalid/missing are now treated as stale and replaced, eliminating
  permanent blocking by a malicious/corrupted lock. The lockfile is now **isolated per user**
  (`ali-coins-<uid>.lock` in tmpdir), preventing interference between users on shared hosts.
- **Graceful shutdown in `all.js`:** new `gracefulExit` closes the Playwright browser and
  releases the lockfile before exiting on all paths (`process.exit()` does not run the
  `finally` block), avoiding orphan Chromium processes and stuck locks on failures.
- **PII marking in logs:** e-mails/phones are no longer logged in clear (`[Login] User`,
  authentication, session save/load/rotation/migration, import/export) and use `maskUser`.
- **Heartbeat without stack trace:** `pingFail` sends only `Name: message` (2000-char limit)
  to the external monitor, without internal paths/sensitive URLs from the stack.
- **Diagnostics pruning without side effects:** `pruneSessionBackups({ scratchDir })` no
  longer cleans temporary files in the project default directory when no explicit session
  path was provided.
- **Export validates target account:** `exportSession` accepts `expectedUser` (used by
  `--account` and `--all`) and fails if the session `meta.user` does not match the requested
  account, instead of validating against its own metadata (tautological check).
- **Push without token in `argv`:** `push_to_github.sh` authenticates via
  `GIT_CONFIG_KEY_0=http.extraHeader` in an environment variable, preventing the
  Basic/PAT header from appearing in the git command line (visible to other local users via
  `ps`).
- **Residual PII in logs and reports (final sweep):** full e-mails were also masked in
  `libs/ui/login.js` (authentication failure), `libs/report.js` (unified report) and
  `collect.js` (error context and balance-failure message), closing the last points that
  still logged the identifier in clear.
- **Shutdown never hangs on `browser.close()`:** `gracefulExit` limits Chromium closure to
  10s (with `unref` on the timer), ensuring a stuck browser does not prevent cron shutdown or
  leave the lock stuck.
- **Secondary locks isolated per user:** accounts beyond the primary also use the uid
  suffix in the lock name (`ali-coins-<uid>-<hash>.lock`), eliminating collision between
  users with same-named accounts.

### Added

- **Tests (191 total):** lock with future/invalid/missing `createdAt`, per-user lockfile
  isolation, heartbeat without stack, target-account validation on export and PII masking
  in session logs. Removed local sensitive leftovers (pre-privacy DOM dumps,
  `mobile_body.html`, old exported tokens and `credentials.env.bak`).

## [0.9.6] - 2026-09-17

### Fixed

- **Lockfile with atomic publication via hardlink:** the lock is now written completely to
  a temporary file (with `fsync`) and published via `fs.link` (fails with `EEXIST` without
  overwriting). Eliminates the partial-read window from the previous fix, where a
  competitor could read an empty lock between `open('wx')` and write, remove it and both
  consider themselves owners (reproduced: 12 overlaps under stress). `wx` fallback with
  900ms read grace on filesystems without hardlink.
- **Complete `.dockerignore` for secrets:** covers `session*.json`, `session_meta*.json`,
  `session_token*.txt`, `accounts.json`, `*.enc`, `credentials.env*` and `sbom.json`,
  preventing secondary plaintext sessions, metadata and tokens from being baked into image
  layers.
- **Chromium environment without secrets:** `getChromiumEnv` filters sensitive variables
  (`SESSION_SECRET`, `ALI_PASSWORD`, `TELEGRAM_*`, `GITHUB_*`, `NOTIFY_*`, `HEARTBEAT_*`,
  `*_TOKEN`, `*SECRET*`, `*PASSWORD*`, `api_key`) before passing env to browser
  subprocesses.
- **Session preservation on DOM failure:** `collect.js` no longer removes
  `session.json.enc`/metadata when streak/balance cannot be read — the failure may be only
  layout. Cleanup still occurs in `validateAndRefresh` only with proven expired
  authentication cookie.
- **New login clears remote-session markers:** `saveSession({ freshLogin: true })` (used by
  `performMobileLogin`) removes `isImported`/`importedAt`, avoiding false "remote session
  expired" alerts after local login with password/2FA.
- **Multi-account key rotation:** `export_session.js --rotate` now uses
  `rotateAllSessions`, rotating all configured accounts (before only the primary was
  migrated, leaving secondary accounts stuck on the old key); partial failure returns exit
  code 1.
- **Container with real healthcheck:** `HEALTHCHECK` actually validates
  `node all.js --dry-run --json` (no misleading fallback) and `Dockerfile` sets
  `NODE_ENV=production` (JSON logs without depending on `pino-pretty`).
- **Point fixes:** heartbeat `User-Agent` derived from the real `package.json` version;
  `--from-file`/`--account` preserve values with `=`; multi-account schema aligned with
  `isImportedSessionExpired`; `push_to_github.sh` no longer forwards arguments (e.g.
  `--force`) to the `main` push; `SCRYPT_N` floor warning emitted only once.

### Added

- **Regression tests (187 total):** lock concurrency stress with 6 processes (zero
  overlaps), Chromium env sanitization, `freshLogin`, multi-account rotation and selector
  smoke test discovery (`selectors.smoke.test.js`). The `test_helper` anti-destruction
  guard now dynamically covers all real sessions/tokens/accounts (including secondary).

## [0.9.5] - 2026-09-17

### Fixed

- **Cooperative action cancellation on timeout (`withTimeout` + `AbortSignal`):** the
  per-attempt task timeout (`TASK_MAX_DURATION_MS`) now provides an `AbortSignal` aborted
  on trigger, propagated through `executeTaskAction`, `waitWithScroll`,
  `executeSurpriseItems` and `executeSearchTask`. The orphan action no longer manipulates
  the same `page` in the background, ending at scroll/click checkpoints.
- **DOM dump privacy (`captureDomHashAndArtifacts`):** the `dom-*.hash.txt` artifact now
  stores only SHA-256 hash, timestamp, target and HTML size. The full normalized HTML
  (which may contain account/CSRF data) is only attached with explicit opt-in via
  `PW_DUMP_DOM=true` in local debugging. The `scratch/` directory is restricted to `0o700`.
- **Universal Telegram message truncation:** `sendTelegram` now applies
  `truncateMessageIfNeeded` to **all** messages (including failures with long Playwright
  stack traces) and the plain-text fallback, avoiding silent HTTP 400 from exceeding 4096
  characters.
- **Remote session alert in multi-account mode:** `buildMultiAccountReportPayload` now
  propagates `isImportedSessionExpired`, reactivating the "Expired Remote Session" warning
  block in the consolidated notification (previously dead code).
- **PT-BR validation messages in Zod 4:** `ALI_USER`/`ALI_PASSWORD` use the `error` option
  (which replaced `required_error`/`invalid_type_error`), restoring Portuguese messages for
  invalid `credentials.env`.
- **Gitleaks without directory allowlist:** the generic `tests/` exclusion was removed and
  replaced by an allowlist of exact fictitious **values**. Full history scanning now covers
  any real secret, including in tests.
- **CI supply chain:** all GitHub Actions (`checkout`, `setup-node`, `upload-artifact`,
  `gitleaks-action`, `codeql-action`, `fetch-metadata`) were pinned by commit SHA with a
  version comment; the workflow declares `permissions: contents: read` by default and
  `persist-credentials: false` on checkouts.

### Added

- **Import token hygiene:** `import_session.js --all` removes each `session_token*.txt`
  after successful import (single use), with opt-out via `--keep-tokens` or
  `KEEP_SESSION_TOKENS=true`. Documented in `README.md` and `CLOUD_SESSIONS.md`.
- **Regression tests:** `AbortSignal` abort on timeout, immediate `waitWithScroll`
  termination on abort, action on an already aborted task without touching the browser, DOM
  artifact without HTML by default (+ opt-in), `0700` diagnostics directory, long error
  truncation in Telegram, multi-account remote-session flag, PT-BR Zod messages,
  token removal/preservation (179 tests total).

## [0.9.4] - 2026-09-17

### Fixed

- **Atomic lockfile acquisition (`acquireLock`):** eliminated the TOCTOU
  (_time-of-check to time-of-use_) window that allowed two instances to acquire the same
  lock simultaneously under real concurrency (reproduced in 2/25 runs with 6 processes).
  Creation now uses the exclusive `wx` flag (`O_CREAT|O_EXCL`) with `fsync`, existing lock
  inspection and up to 5 attempts after removing orphan/stale locks. Defense against symlink
  in the lock path added: the link is removed without ever following the target (preventing
  malicious truncation of files in `/tmp`).
- **Correct shutdown on SIGINT/SIGTERM:** lockfile signal handlers no longer suppress
  Node's default behavior. On `SIGINT`/`SIGTERM`, the lock is released, listeners are
  removed and the signal is re-emitted, terminating the process immediately (before, the
  process stayed alive in the background with Chromium running). After normal lock release,
  listeners are also removed, restoring default `Ctrl+C`.
- **stdout/stderr flush before shutdown (`libs/exit.js`):** new `flushAndExit()` helper
  waits for physical flush of `stdout`/`stderr` before calling `process.exit()`. Eliminates
  silent truncation of JSON reports and tokens (`--json`, `--show-token`) at the pipe buffer
  limit (~64 KB), keeping exit codes 0–6 unchanged.
- **Secret masking in logger (`redact` + recursive scrub):** invalid fast-redact paths
  (`*secret*`, `*passwd*`) were replaced by valid paths and a recursive scan
  (`scrubSensitiveFields`) now masks sensitive keys by prefix/suffix (`my_secret_field`,
  `userToken`, `apiKey`, nested objects) without mutating the caller's original object.
- **Non-destructive session reads (`loadSessionFiles`):** transient I/O errors
  (`EACCES`/`EMFILE`/`EINTR`) no longer remove `session.json.enc`, `session.json` or
  `session_meta.json`. File removal only occurs when migration completes successfully;
  malformed JSON is preserved for diagnosis instead of automatically deleted.

### Added

- **Concurrency and shutdown regression tests:** dedicated coverage for double acquisition
  under 6 concurrent processes, symlink defense, `SIGINT` shutdown with lock release, no
  `stdout` truncation above 64 KB, sensitive-key scrub and session file preservation under
  `EACCES`/malformed JSON/migration failure (171 tests total).

## [0.9.3] - 2026-09-17

### Fixed

- **Atomic session writing (`safeWriteFile`):** eliminated the risk of truncated session and
  token files from abrupt process termination (`SIGKILL`, exit 137 / OOM in low-memory
  environments). The method writes first to a temporary file with `0o600` permission
  (`<destination>.tmp-<pid>-<rand>`), performs a physical `fsync` and completes with atomic
  replacement (`fs.promises.rename`). On failure, the destination file remains 100% intact
  and orphan temporary files are automatically removed at boot.
- **Global failure handler and crash handler (`setupGlobalCrashHandler`):** global handling
  for uncaught exceptions (`uncaughtException`) and unhandled rejections
  (`unhandledRejection`) in `all.js`, `collect.js` and `do_tasks.js`. The handler logs at
  `fatal`, performs a best-effort partial Telegram notification and failure heartbeat, and
  exits with the new standardized **`6`** code (with a 5s safety timeout to prevent hangs).
- **CI Windows test resilience (`--test-timeout=35000` and `SCRYPT_N`):** native test suite
  timeout increased from 15s to 35s in `test` and `test:coverage`, preventing spurious
  timeouts on the GitHub Actions `windows-latest` VM caused by heavier scrypt v3
  computation (`N=131072`). Added `SCRYPT_N` environment support and a programmatic setter
  in `SCRYPT_PARAMS_V3` for resource-restricted hosts.
- **Case-insensitive account deduplication (`loadAccounts`):** normalized `.toLowerCase()`
  comparison in `config.js` registration and account grouping (`accounts.json`, primary
  `ALI_USER` and `ALI_USER_2..20`), aligning with the session importer and preventing
  spurious locks/duplicate files for the same account (e.g. `Foo@x` and `foo@x`). Fully
  preserves the first registration (user, `maskedUser`, index, lock and paths) and inherits
  `telegramChatId` if absent.
- **Sanitization and normalization in multi-account template (`libs/notify.js`):**
  defensive coercion of `streakDays` to a number or `'N/D'`, coin values (`totalCoins`,
  `checkinCoins`, `tasksCoins`) to safe integers `>= 0` via `toSafeInt`, and `escapeHtml` on
  multi-account block interpolations. Prevents malformed values or exotic characters from
  breaking the Telegram Bot API HTML parser (`400 can't parse entities`), preserving
  byte-identical output for valid inputs.
- **Cryptographic security floor in `SCRYPT_N` (`security.js`):** mandatory minimum
  $N \ge 16384$ ($2^{14}$) for scrypt key derivation. Lower values configured via
  `SCRYPT_N` or programmatic options emit a structured warning (`logger.warn`) and are
  defensively clamped to the secure default $131072$ ($2^{17}$), preventing accidental
  weakening of AES-256-GCM encryption without causing fatal process failures.
- **Supply-chain gate in Dependabot auto-merge:** updated
  `.github/workflows/dependabot-automerge.yml` with an active `gh api` verification step
  that waits for the `CI` workflow (Linux, macOS and Windows matrix) to complete
  successfully on the PR's exact SHA before authorizing auto-merge (`squash`), preventing
  premature merges even without active branch protection rules.
- **scrypt parameter sanitization in untrusted tokens (`sanitizeScryptParams`):**
  `decryptSession` no longer blindly trusts `N:r:p` markers embedded in `v3` tokens. New
  defensive ceilings (`N <= 2^20`, `r/p <= 16`) and a combined memory limit
  (`128*N*r <= 256 MB`, with progressive reduction and safe fallback) prevent memory/CPU
  exhaustion from a forged or corrupted token, keeping full compatibility with legitimate
  `v1`, `v2` and `v3`.
- **Numeric coercion of `options.N` in encryption:** `encryptSession` now accepts `N` as a
  numeric string (e.g. `'16384'`) and applies the same decryption sanitization, ensuring any
  generated token is always decryptable and eliminating the cryptic
  `The "N" argument must be of type number` error.
- **Phone/identifier mask (`maskUser`):** users without `@` (phones/IDs) no longer expose
  final digits in notifications and logs (`11999887766` now shows `11***` instead of
  `11***66`). E-mails remain unchanged.
- **Credential quoting documentation:** `credentials.env.example` and
  `INSTALL_LINUX/WINDOWS/MACOS.md` now explicitly warn that passwords with `#`, spaces or
  `!` require double quotes, avoiding silent `dotenv` truncation (e.g.
  `ALI_PASSWORD="abc#123!"`).

### Added

- **Encryption with parameter marker and v3 support:** new session tokens generated in the
  versioned format `v3:N:r:p:salt:iv:tag:ciphertext:base64` with robust parameters
  (`scrypt N=131072` / 2¹⁷, `r=8`, `p=1`). The deserializer (`decryptSession`) provides
  transparent support and full cross-version backward compatibility between `v3`, `v2` and
  `v1`.
- **Variable synchronization in `credentials.env.example`:** detailed documentation with
  examples and explanations for `DIAGNOSTICS_RETENTION_DAYS` (artifact and trace retention
  in `scratch/`, default 7 days) and `NOTIFY_HOST_LABEL` (host label customization in
  Telegram messages).
- **PID reuse race documentation in lockfile:** security analysis in `lockfile.js` code
  documenting fail-safe behavior on eventual OS PID recycling and the definitive mitigation
  via `staleTimeoutMs` (30 min).

## [0.9.2] - 2026-09-17

### Fixed

- **Task dispatcher anti-hang (repeated rounds):** granular attempt tracking per round
  (`getRoundKey`, combining `taskTitle + statusText`). When reaching the configurable limit
  (`TASK_ROUND_MAX_ATTEMPTS=3`, default 3) without progress in `statusText` or
  `completedRounds` (e.g. stuck due to msite/server throttling), the dispatcher gives up
  with descriptive status `'Failed (no progress after 3 attempts)'` and excludes it from
  the cycle, eliminating unnecessary repetitions.
- **Strict per-task-attempt timeout (`TASK_MAX_DURATION_MS`):** `withTimeout` wrapper
  (`TASK_MAX_DURATION_MS=180000`, default 3 minutes / 180s) aborting frozen attempts on
  time, counting the spent action, closing orphan child tabs or forcing cancellation of
  hanging navigations with `page.goto(coin-index, { waitUntil: 'commit', timeout: 10000 })`
  to guarantee isolation of the next action.
- **Fail-fast on slow pages (`TASK_SCROLL_MAX_MS`):** defensive cap in `waitWithScroll`
  (`TASK_SCROLL_MAX_MS=30000`, default 30 seconds) and early exit when no tracking signal
  is detected (`earlyExitOnNoProgress`, with backward-compatible aliases
  `earlyExitOnNoTracking` and `noTrackingTimeoutMs` deprecated).
- **Transparency and integrity in the final report:** tasks that give up or fail are
  strictly categorized as `Failed (...)` via `classifyTaskStatus(t, { failedTasks })` and
  never as `Completed`, faithfully reflecting data in the printed summary, JSON payload and
  Telegram/multi-account notifications.
- **Real duration in Telegram notifications:** eliminated the static `'0s'` value in
  `all.js` when sending individual account reports in multi-account, adding accurate
  per-account/stage timing and defensive, intelligent `totalDuration` resolution in
  `buildUnifiedReportPayload`, `buildMultiAccountReportPayload` and `libs/notify.js` from
  real start/end and stage timestamps.

## [0.9.1] - 2026-09-16

### Fixed

- **Coin calculation on already-collected check-in (Bug 12):** in
  `buildUnifiedReportPayload()` (`libs/report.js`), added the condition
  `checkinResult.alreadyCollected === false` to the `checkinCoinsGained` calculation.
  Avoids duplication or counting informative coins on subsequent same-day runs.
- **Multi-account session protection in the importer (Bug 13):** in `import_session.js`,
  throws an explicit `ImportSessionError` when the token e-mail does not match any account
  configured in `credentials.env` or `accounts.json` in environments with more than one
  account (`accounts.length > 1`), preventing accidental overwrite of the primary Account 1.
- **Streak isolation between accounts (Bug 14):** in `collect.js`, `previousStreakDays` now
  validates `sessionStatus.previousMeta?.user === userEmail` before reusing the previous
  streak, preventing new accounts from inheriting old accounts' day sequence and emitting
  false streak-break alerts.
- **Alert routing in Telegram (Bug 15):** in `libs/notify.js`, `resolveUser()` returns
  `null` for consolidated multi-account reports (`multi_account_report`) and omits the
  `👤 Account:` line in global-scope alerts (`streak_break`, `lock_active`, `failure`,
  `2fa_required`).
- **Test suite reliability on Node.js 22:** disabled asynchronous `pino.transport` worker
  threads during tests (`NODE_TEST_CONTEXT` / `NODE_ENV=test`) in `logger.js`, added a
  defensive 15-second timeout (`--test-timeout=15000`) in `package.json` and adjusted the
  timeout to 500ms in the non-interactive 2FA test (`tests/non_interactive_2fa.test.js`).

## [0.9.0] - 2026-09-16

### Fixed

- **Session divergence and improper cleanup in multi-account:** fixed the root cause of
  `Active session account ("account1") does not match configured account ("account2")`.
  `resolveSessionPaths` (`libs/session.js`) now dynamically derives the corresponding
  metadata path (`session_meta_<hash>.json` or `session_meta.json`) from the account's
  `sessionPath`. `collect.js` removed the hard fallback to global paths, and
  `validateAndRefresh` no longer runs destructive `clearSession` if the cache belongs to
  another configured account in `credentials.env`. Added transparent, non-destructive
  legacy session migration via `syncAccountSessions` (`config.js`) and strict Playwright
  browser context isolation between account iterations in `all.js`.

### Added

- **Multi-account export (`export_session.js`):** native multi-account support with
  `--all` and `--account <id|email>`. In environments with more than one configured account,
  the utility exports all active accounts generating individual encrypted tokens
  (`session_token.txt`, `session_token_2.txt`, etc.) or exports strictly the requested
  account.
- **Import with smart auto-routing (`import_session.js`):** native support for `--all` and
  `--account <id|email>`. The importer inspects the decrypted payload (`meta.user`) and
  routes the write automatically to the respective account's isolated file
  (`session.json.enc` for Account 1, `session_<hash>.json.enc` for secondary accounts),
  preventing accidental overwrites. `node import_session.js --all` imports and protects all
  accounts at once on the remote server.

## [0.8.3] - 2026-09-16 (updated on 2026-09-16)

### Fixed

- **Windows batch scripts (`setup_windows.bat`, `run_all.bat`, `run.bat`,
  `run_tasks.bat`):** fixed Node.js version validation (`set NODE_MAJOR` with `LSS`
  operator), eliminating the `cmd.exe` parsing error caused by `< 22` and `||` operators in
  inline commands that stopped execution in the first lines. Added `chcp 65001 >nul` for
  native UTF-8 in CMD, directory anchoring with `cd /d "%~dp0"`, removed `||` in the
  Chromium test and a defensive `pause` mechanism when detecting failure in double-click
  runs from File Explorer.
- **UTF-8 encoding in Windows PowerShell (`run_all.ps1`, `run.ps1`, `run_tasks.ps1`,
  `setup_windows.ps1`):** native full UTF-8 support (`chcp 65001`,
  `[Console]::OutputEncoding`, `[Console]::InputEncoding` and
  `$OutputEncoding = [System.Text.Encoding]::UTF8`) and argument forwarding via splatting
  (`@args`), eliminating corrupted characters/mojibake in logs, accents and emojis (`🪙`,
  `💰`, `⏱️`, `✅`, `🚨`).

### Added

- **Automatic diagnostics retention in `scratch/`:** expanded `pruneSessionBackups`
  (`libs/session.js`) to expire diagnostic artifacts in `scratch/`
  (`*-trace-*.zip`, `*.png`, `dom-*.hash.txt`, `mobile_body.html`, `*.jpeg`) sharing the
  `SESSION_BACKUP_RETENTION_DAYS` or `DIAGNOSTICS_RETENTION_DAYS` policy (default 7 days)
  and full `--dry-run` support. Strict protection guaranteed: essential session and
  scheduling files (`session.json`, `session.json.enc`, `session_meta.json`,
  `session_token.txt`, `cron.log`, `credentials.env`) remain 100% protected from accidental
  removal.
- **Windows SESSION_SECRET generator (`generate_secret.bat`, `generate_secret.ps1`):**
  dedicated utilities to generate 32-byte Base64 keys for `SESSION_SECRET`, optionally
  supporting OpenSSL (`openssl rand -base64 32`) with automatic binary detection on the
  system or Git for Windows, and a complementary native solution via Node.js crypto
  (`crypto.randomBytes(32)`) and .NET `RandomNumberGenerator`, without requiring separate
  OpenSSL installation on Windows.
- **Automatic key setup in Windows Setup:** `setup_windows.bat` and `setup_windows.ps1` now
  automatically generate and pre-configure `SESSION_SECRET` in the newly created
  `credentials.env`, with detailed guidance in `INSTALL_WINDOWS.md`.
- **Automatic key setup in Linux and macOS Setup (`setup_linux.sh`, `setup_macos.sh`):**
  integration of automatic `SESSION_SECRET` generation (32-byte Base64 AES-256) when
  creating `credentials.env` from the template, with `openssl` detection and native
  `crypto.randomBytes(32)` Node.js fallback, guaranteeing full cross-platform parity (Linux,
  macOS and Windows) and synchronization with the manuals (`INSTALL_LINUX.md`,
  `INSTALL_MACOS.md`).

### Changed

- **Dependency maintenance:** `prettier` updated from `3.9.6` to `^3.9.7` in
  `devDependencies`.

## [0.8.2] - 2026-09-15

### Fixed

- **Encrypted at-rest import:** `import_session.js` now saves to `session.json.enc` by
  default (AES-256-GCM v2, `0o600` permission) respecting `ENCRYPT_LOCAL_SESSION=true`,
  with explicit opt-out via `--plaintext` and safe migration of legacy `session.json`,
  removing plaintext only after successful write and encryption.
- **Resilient streak-break guard:** prevented a false broken-streak positive caused by a
  spurious 7-day weekly-cycle read from the mobile UI when the previous history streak was
  much higher (`isStreakBreak`, commit `15d2725`).
- **Telegram error notifications:** root-cause extraction
  (`extractRelevantErrorMessage`) isolating the error message before Playwright shutdown log
  delimiters (`cleanup`, etc.) (commit `b1293ac`).
- **Task accounting in Telegram:** deterministic balance-difference fallback
  (`balanceFinal - balanceAfterCheckin`) when `meta.tasksCoinsGained` is absent (commit
  `b1293ac`).
- **Docker session mount:** `docker run` examples in `README.md` updated to mount
  `session.json.enc`, `session_meta.json` and `session.json` after `touch` and
  `chmod 600` (commit `b1293ac`).
- **Cross-platform installers:** fixed Windows execution with directory anchoring
  (`cd /d "%~dp0"`), native Node.js `>= 22` validation without fragile batch string
  parsing, direct Playwright CLI call, ACL permissions via `icacls`, native PowerShell
  installer (`setup_windows.ps1`), numbering/permission adjustments in `setup_linux.sh` and
  `setup_macos.sh`, and full installation manual synchronization (`INSTALL_WINDOWS.md`,
  `INSTALL_LINUX.md`, `INSTALL_MACOS.md`).
- **Telegram manual and conversation initialization:** formal documentation of the
  mandatory initial authorization step via `/start` before credential registration,
  reflecting the Telegram Bot API architecture restriction that prevents bots from
  originating conversations with users (`TELEGRAM.md`, `README.md`, `CLOUD_SESSIONS.md`),
  plus a proactive tip in the logger (`libs/notify.js`).

### Added

- **Custom host label:** `NOTIFY_HOST_LABEL` variable in `config.js` and `libs/notify.js`
  for readable machine/server identification in disposable containers (`--rm`).
- **Send confirmation in log:** informative log (`logger.info`) when dispatching Telegram
  notifications successfully (`libs/notify.js`), facilitating visual delivery tracking in
  console logs and schedulers (cron).
- **Logrotate example for Cron:** `CLOUD_SESSIONS.md` section with a `logrotate`
  configuration template (`copytruncate weekly rotate 4`) for scheduling log management on
  cloud servers.

## [0.8.1] - 2026-09-15

### Fixed

- **Coin accounting in Telegram:** report now uses balance delta (final balance − initial
  balance) instead of an estimated sum, with updated template (`all.js`, `do_tasks.js`,
  `libs/notify.js`, `libs/report.js`, `libs/tasks/verifier.js`).

## [0.8.0] - 2026-09-14

### Added

- **At-rest session encryption:** `session.json.enc` persistence using AES-256-GCM v2 with
  `scrypt` derivation and dynamic salt (`ENCRYPT_LOCAL_SESSION=true`).
- **Transparent migration:** automatic reading of `session.json.enc` with legacy
  `session.json` fallback and automatic migration.
- **Key rotation:** support for `SESSION_SECRET_OLD` and CLI command
  `node export_session.js --rotate --new-secret-from-env=VAR` via `rotateSessionSecret`.
- **Versioned backups & retention:** secure backup generation in
  `scratch/session.bak-<timestamp>.json.enc` (0o600) and automatic expiration policy
  (`pruneSessionBackups`, `SESSION_BACKUP_RETENTION_DAYS=7`).
- **Observable selectors & diagnostics:** automatic SHA-256 hash capture of normalized HTML
  (`scratch/dom-<timestamp>.hash.txt`) and screenshot (`scratch/tasks_drawer_failed.png`) on
  task drawer failures (`captureDomHashAndArtifacts`).
- **Telegram notifications:** full native support for Telegram Bot notifications
  (`libs/notify.js`, `--notify` / `--no-notify` flags), multi-account support with dedicated
  chat IDs (`TELEGRAM_CHAT_ID_${i}` / `telegramChatId` in `accounts.json`), resilient
  formatting with clean summary and error handling without interrupting automation.
- **Expired remote session alert:** immediate log and Telegram diagnosis when a session
  imported from another host expires, guiding renewal with `node export_session.js`.
- **Multi-account resilience:** sequential queue with exponential backoff with jitter
  (base 2s to 30s cap) between account failures (`calculateAccountBackoff`,
  `ACCOUNT_BACKOFF_BASE_MS`) and notification calls fully shielded against exceptions.
- **Selector smoke tests:** `tests/selectors.smoke.js` suite with HTML fixture without a
  real browser dependency and an update guide via dump.
- **Docker & BuildKit security:** multi-platform digest-pinned base image
  (`node:22-slim@sha256:...`), dedicated non-root `appuser` (UID 10001 / GID 10001),
  BuildKit cache-mount note `/ms-playwright` and smart HEALTHCHECK
  (`CMD-SHELL [ -f credentials.env ] && node all.js --dry-run --json ...`).
- **CI & coverage:** native line coverage threshold raised to `>= 80%`, CycloneDX SBOM
  generation, Gitleaks secret scan, basic CodeQL and Dependabot auto-merge.
- **Supply chain & upgrades:** update to `commander` v15 and `eslint` v10 (with `globals`),
  zero-vulnerability audit and strict `0o600` permission audited on all secret artifacts.
- **Streak-Break Guard (P1):** streak history tracking with safe persistence
  (`updateSessionStreak`, `lastStreakDays`, `lastCheckinDate` in `session_meta.json`).
  Deterministic detection of streak reset (e.g. 200 ➔ 1 days) with zero false positives on
  the first run (`isStreakBreak`), critical Telegram alert (`🚨 STREAK BROKEN`) and exit
  with **exit code 4**.
- **2FA Fail-Fast in Cron / CI (P2):** automatic detection of non-interactive environment
  (`!process.stdin.isTTY`). When AliExpress requests 2FA verification, exits immediately in
  `<5s` with typed error `TwoFactorRequiredNonInteractive`, Telegram alert with session
  renewal steps and **exit code 5** (eliminating the 120s cron block).
- **Dead Man's Switch / Heartbeat:** native integration with uptime monitors
  (Healthchecks.io, Uptime Kuma) via `HEARTBEAT_URL` and `HEARTBEAT_TIMEOUT_MS`. Sends
  start (`/start`), success with report and failure (`/fail`) pings, safe token/UUID masking
  in logs and CLI control flags (`--heartbeat` / `--no-heartbeat`), preventing silent
  failures on servers/VPS without changing exit codes.

### Changed

- Optimized the task loop to classify "Write reviews" as special and avoid 4 attempts
  without a delivered order.
- Strict `--json` isolation directing operational logs to `stderr` (`pino.destination(2)`).
- Check-in report honestly reporting `N/D` when the day's coin statement could not be
  extracted.

### Fixed

- **Streak detection and resilience:** comprehensive multilingual support (pt-BR, en-US,
  es-ES) with flexible regexes ("Sequência de X dias", "X dias seguidos", "X-day streak",
  "Dia X/7"); streak capture in the post-check-in modal before it closes; automatic desktop
  fallback via consecutive-date history counting and deterministic reward-tier mapping
  (+10 to +40 coins), eliminating the false `N/D`.
- **Full multi-round task execution (Explore Surprise Items and Super Deals):**
  - **Dynamic card re-query:** in surprise item tasks, dynamic DOM element re-query on every
    click and incremental card scroll, eliminating stale element references caused by
    `goBack()` navigation and completing all rounds (e.g. 2/2).
  - **Real dwell in SuperDeals/Discounts:** removed the premature 5s cut by tracking
    detection in `waitWithScroll`, guaranteeing a minimum 16-second dwell with gradual
    scrolling required by AliExpress to validate rounds (e.g. 3/3).
  - **Intermediate reward claim:** support for collect buttons (`Coletar`, `Collect`,
    `Claim`, `Receber`, `+5 coins`), claiming immediately before proceeding to the next task
    round.
  - **Attempt reset by round progress:** automatic clearing of the task's consecutive
    attempt counter when rounds advance, preventing premature blocking by the
    `TASK_MAX_ATTEMPTS` cap.
  - **Improved post-task synchronization:** stabilization time after return increased to
    2500ms, allowing coin animations and msite AJAX requests to finish updating the DOM.
- **Skeleton self-healing and resilience when opening the task panel:**
  - **Selector syntax fix (`openDrawerBtn`):** removed invalid engine prefixes (`text=...`)
    in comma-separated lists that caused a Playwright parse error and silent `null` return.
    Added `#signButton` and dedicated task classes (`.aecoin-taskButton-3V41b`,
    `[class*="taskButton"]`), with semantic fallback via `page.getByRole('button')`.
  - **Hydration patience and single defensive reload:** self-healing with patient waiting
    for post-load hydration and at most one defensive reload, eliminating concurrent
    cascading reloads in the middle of click attempts that interrupted AliExpress SPA
    mounting.
  - **Direct mobile navigation:** direct access to the mobile URL with immersive parameters
    (`_immersiveMode=true&from=pc302`) in `do_tasks.js`, eliminating 302 redirect conflicts
    that cancelled SPA script loading.
  - **Modal conflict elimination:** removed the task button selector
    (`.e2e_normal_task_right_btn`) from `SELECTORS.modals.closeButtons`, preventing
    `closeModals` from interfering with task actions.

---

## [0.7.0] - 2026-09-14

### Added

- Unified orchestrator (`all.js`) integrating check-in and batch tasks.
- Sequential multi-account support (`ALI_USER_2`, `accounts.json`).
- Structured `--json` flag support for pipelines and scripts.
- Resilient handling of security challenges and mobile 2FA.
- Strict 0o600 permissions on all secret files.
- AES-256-GCM v2 encryption with dynamic salt.
