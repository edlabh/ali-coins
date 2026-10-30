# AliExpress Coin Collector & Task Runner

> 🌐 **Languages:** [Português](README.md) | [English](README.en.md)

> ℹ️ English translation of the canonical Portuguese documentation. If there is any divergence, the Portuguese version prevails.

Complete automation for **daily coin check-in** and **task execution ("Earn more coins")** on AliExpress with mobile emulation (Google Pixel 7 / Android) via Playwright.

Compatible with **Linux (Ubuntu / Debian)**, **Windows 10/11**, and **macOS (Apple Silicon & Intel)**.

Requires **Node.js >= 22** (`.nvmrc: 22`).

---

## Key Features

- **Unified Mode (Single Command):** Runs the daily check-in and all panel tasks in sequence, producing a consolidated report with the initial balance, earnings per task, and final balance.
- **Smart Daily Check-in:** Compatible with the AliExpress card layout. Keeps active streaks (including 200+ days) and progressive values (+10 up to +40 coins/day). Bilingual balance detection ("My coins" / "Minhas moedas").
- **Automated Daily Tasks:** Runs tasks in batches (surprise products with real dwell time, keyword search, and scroll navigation).
- **Resilient Session & Account Switching:** Strict cookie validation (`xman_us_t`). Detects account changes in `credentials.env` and renews credentials safely.
- **High-Security v3 Encryption:** Secure session export using `scrypt` derivation with a dynamic 16-byte cryptographic salt, explicit parameters, and `AES-256-GCM` encryption (format `v3:N:r:p:salt:iv:tag:ct:base64`). Maintains backward compatibility with legacy `v1` and `v2` tokens.
- **Lockfile with Concurrency Prevention & Stale Timeout:** Prevents overlapping Cron runs with hostname + PID checks and an inactivity timeout (default: 30min).
- **Playwright Diagnostics:** Automatic trace capture (configurable via `PW_TRACE`; `retain-on-failure` in the default profile, `off` in low-memory mode), screenshots (`only-on-failure`), and optional video in `scratch/`.

### What's new in 2.5.0

- **Observability:** structured `run_metrics` event per execution with `runId`, masked
  account, durations, check-in/tasks outcome, streak and coins. SLIs, SLOs and playbooks
  in [OBSERVABILITY.en.md](OBSERVABILITY.en.md) ([PT](OBSERVABILITY.md)).
- **Stable i18n IDs:** messages use `id → { pt, en }` with legacy-key compatibility and
  migration telemetry.
- **Lighter boot:** `--help`, `--dry-run` and `--check-session` no longer load Playwright;
  ~48% less time/RSS on those paths. Measurements in
  [PERFORMANCE.en.md](PERFORMANCE.en.md) ([PT](PERFORMANCE.md)).
- **Session:** `expiresAt` is advisory; real validity remains cookie-based.
  `--check-session` exposes `warnings` when the estimate has passed.
- **CI:** ShellCheck, actionlint, Windows PowerShell validation, CodeQL, Gitleaks, Docker
  smoke, coverage ≥80% and audit as blocking gates.

---

## Execution Modes

| Mode                      | Description                                                     | Windows CMD             | Windows PowerShell | Linux / macOS            | npm                      |
| :------------------------ | :-------------------------------------------------------------- | :---------------------- | :----------------- | :----------------------- | :----------------------- |
| **Unified (Recommended)** | Check-in + all tasks in sequence                                | `run_all.bat`           | `.\run_all.ps1`    | `./run_all.sh`           | `npm start`              |
| **Check-in Only**         | Daily check-in and balance lookup                               | `run.bat`               | `.\run.ps1`        | `./run.sh`               | `npm run collect`        |
| **Tasks Only**            | "Earn more coins" panel                                         | `run_tasks.bat`         | `.\run_tasks.ps1`  | `./run_tasks.sh`         | `npm run tasks`          |
| **Validation (Dry-Run)**  | Validates credentials and environment without opening a browser | `run_all.bat --dry-run` | `.\run_all.ps1 -d` | `./run_all.sh --dry-run` | `npm start -- --dry-run` |

> 💡 **Windows (encoding):** the `run_all.bat`/`.\run_all.ps1` scripts (and other variants)
> already configure the console for UTF-8. If you run via `npm start`/`node` directly, run
> `chcp 65001` (CMD) or `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 > $null`
> (PowerShell) first to avoid broken accents/emojis in the log.

---

## Command-Line Options (CLI)

The CLI supports the following unified flags (via `commander`):

| Flag                 | Description                                                                                                                                    |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `-d, --dry-run`      | Runs the full credentials and environment validation without launching Chromium.                                                               |
| `--check-session`    | **Read-only** check: opens the coin center and reports whether the session is still authenticated (balance/streak), with no check-in or tasks. |
| `-f, --force`        | Forces execution: overrides an active lockfile **and ignores the post-captcha cooldown** (attempts login even during the pause).               |
| `--no-delay`         | Does not apply the random initial delay (`START_DELAY_MIN_MS`/`START_DELAY_MAX_MS`) in this run (manual/retry runs).                           |
| `--json`             | Emits the execution report, diagnostics, and validation in pure JSON format.                                                                   |
| `--lang <pt-BR\|en>` | Interface and log language: `pt-BR` (default) or `en` (English). Can also be set via `APP_LANGUAGE`.                                           |
| `--notify`           | Forces Telegram notifications for the current run.                                                                                             |
| `--no-notify`        | Disables Telegram notifications for the current run.                                                                                           |
| `--manual-login`     | Opens a manual login window when needed (equivalent to `MANUAL_LOGIN=always`).                                                                 |
| `--no-manual-login`  | Never offers manual login; keeps execution 100% headless (equivalent to `MANUAL_LOGIN=never`).                                                 |
| `--heartbeat`        | Forces heartbeat / dead man's switch for the current run.                                                                                      |
| `--no-heartbeat`     | Disables heartbeat / dead man's switch for the current run.                                                                                    |
| `--all`              | Processes all configured accounts (used by `export_session.js`/`import_session.js`).                                                           |
| `--account <id>`     | Selects the account by index or email in the session CLIs.                                                                                     |
| `--plaintext`        | Allows saving the session without encryption (explicit at-rest opt-out).                                                                       |
| `--keep-tokens`      | Does not remove `session_token*.txt` after import (batch or `--from-file`).                                                                    |
| `--allow-expired`    | Allows importing a token whose estimated validity (`expiresAt`, ~90 days) has already passed. Use with caution.                                |
| `--rotate`           | Re-encrypts sessions with the new key (`SESSION_SECRET_NEW`/`SESSION_SECRET_OLD`).                                                             |
| `--migrate`          | Migrates legacy `session.json` to `session.json.enc` via `import_session.js`.                                                                  |
| `--version`          | Displays the project version.                                                                                                                  |
| `--show-token`       | Displays the encrypted token in the terminal output during `export_session.js`.                                                                |
| `--from-file <path>` | Reads the encrypted token from the specified file during `import_session.js`.                                                                  |
| `-h, --help`         | Displays the help message with the list of available parameters.                                                                               |

Side-effect-free diagnostic example:

```bash
npm start -- --check-session            # all configured accounts
npm start -- --check-session --json     # JSON output (type=session_check)
node collect.js --check-session         # single account / --account <id>
```

The exit code is `0` when every session is valid and `1` when any check fails.
No check-in, task, notification, or heartbeat runs in this mode.

---

## Exit Codes

The scripts return standardized exit codes for continuous integration and Cron/Task Scheduler automation:

|  Code   | Meaning                       | Description                                                                          |
| :-----: | :---------------------------- | :----------------------------------------------------------------------------------- |
| **`0`** | Success                       | Check-in or tasks executed successfully with new coins collected.                    |
| **`1`** | Failure                       | Critical execution error, invalid credentials, or authentication failure.            |
| **`2`** | No Action / Already Collected | Check-in was already performed today and there are no pending tasks.                 |
| **`3`** | Lock Active                   | Another instance of the automation is already running (prevents overlap).            |
| **`4`** | Streak Broken                 | Critical alert: the check-in streak was interrupted/reset (yesterday → today).       |
| **`5`** | Non-Interactive 2FA           | Fast interruption (<5s) in cron/CI when AliExpress requests 2FA (no TTY).            |
| **`6`** | Global Failure                | Uncaught error or rejected Promise (`uncaughtException` / `unhandledRejection`).     |
| **`7`** | Manual Intervention           | Manual login required and not completed (window closed/timeout); no automatic retry. |

---

## Quick Start (3 Steps)

### 1. Clone the repository

```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
```

### 2. Automatic Installation

Run the installer for your operating system:

- **Linux (Ubuntu / Debian):** `./setup_linux.sh` (Detailed guide: [INSTALL_LINUX.en.md](INSTALL_LINUX.en.md))
- **Windows:** `setup_windows.bat` (CMD / double-click) or `.\setup_windows.ps1` (PowerShell) (Detailed guide: [INSTALL_WINDOWS.en.md](INSTALL_WINDOWS.en.md))
- **macOS:** `./setup_macos.sh` (Detailed guide: [INSTALL_MACOS.en.md](INSTALL_MACOS.en.md))

_(The installer checks for Node.js >= 22, runs `npm install`, downloads Chromium, and prepares the credentials.)_

### 3. Configure Credentials and Run

Edit the `credentials.env` file with your settings (restricted permission `0o600`):

```env
ALI_USER="your_email_or_phone"
ALI_PASSWORD="your_password"

# Multi-Account Support (Optional - up to 20 sequential accounts):
# ALI_USER_2="second_account@example.com"
# ALI_PASSWORD_2="second_account_password"

# Webhook Notification (Discord / Telegram / generic HTTP POST)
# NOTIFY_WEBHOOK_URL="https://discord.com/api/webhooks/..."

# Key for session export encryption (minimum 32 characters)
# On Windows using Node.js: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# On Linux/macOS: openssl rand -base64 32
SESSION_SECRET="your_secret_key_with_at_least_32_characters"

# Media blocking (images, videos, fonts) to speed up execution (default: false)
ALLOW_MEDIA=false

# Headless mode (no graphical window) (default: true)
HEADLESS=true

# Optional manual login window (default: auto)
# auto   = 1/2 menu only when login is needed and a TTY + graphical interface are available
# never  = 100% headless (never asks or opens a window)
# always = opens the window directly when login is needed (no menu)
# MANUAL_LOGIN=auto
# MANUAL_LOGIN_PROMPT_TIMEOUT_MS=60000   # menu timeout (default: 60s; expires in headless)
# MANUAL_LOGIN_TIMEOUT_MS=900000         # login window timeout (default: 15min)
# MANUAL_LOGIN_CONTEXT=desktop           # desktop (mouse/captcha) | mobile (Pixel 7)

# Structured log level (trace, debug, info, warn, error, fatal, silent) (default: info)
LOG_LEVEL=info

# Interface, log, report, notification, and helper-script language
# pt-BR = Portuguese (default) | en = English
APP_LANGUAGE=pt-BR

# Optional timeout and limit settings
# NAV_TIMEOUT=35000
# TASK_MAX_ACTIONS=25
# TASK_MAX_ATTEMPTS=4

# External destination security (SSRF): webhook and heartbeat block by default
# loopback/private addresses (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, IPv6 ::1/fd00::/etc.).
# For local tests, explicitly allow them:
# ALLOW_PRIVATE_WEBHOOKS=true

# Task routine (optional)
# SKIP_APP_ONLY_TASKS=true      # skips Prize Land/minigames/quizzes/reviews (default: true)
# TASK_RETRY_UNFINISHED=false   # 2nd pass only on unfinished tasks (default: false)
# TASK_RETRY_PASSES=1
# TASK_RETRY_DELAY_MS=5000
# TASK_PAUSE_MIN_MS=0           # random pause before each task, between MIN and MAX in ms (default: 0/0 = disabled)
# TASK_PAUSE_MAX_MS=0           # e.g. 15000 and 60000 -> 15s to 60s between tasks (MAX >= MIN; max 24 h)
# ACCOUNT_DELAY_MIN_MS=0        # random pause between accounts in multi-account mode, between MIN and MAX in ms (default: 0/0 = disabled)
# ACCOUNT_DELAY_MAX_MS=0        # e.g. 60000 and 180000 -> 1 to 3 min between accounts (MAX >= MIN; max 24 h)
# Random delay at the start of execution (anti-detection; default: 0/0 = disabled)
# START_DELAY_MIN_MS=0          # random wait before starting (real all.js only; --dry-run never delays)
# START_DELAY_MAX_MS=0          # e.g. 0 and 3540000 -> starts within ~59 min (MAX >= MIN; max 24 h); skip with --no-delay
# Note: heartbeat (dead man's switch) tolerance must be >= START_DELAY_MAX_MS.

# Per-account Telegram (optional): also send each account's individual result (default: false)
# TELEGRAM_PER_ACCOUNT=false

# Memory: reusing a single desktop context per account raises peak RAM on the host.
# Default: false (recommended on 1 GB hosts). Enable only with memory headroom.
# DESKTOP_REUSE_CONTEXT=false

# --- Advanced options (all optional; same keys as credentials.env.example) ---
# Report timezone (display only). The accounting "day" for the statement/streak is always
# America/Los_Angeles (AliExpress timezone).
# REPORT_TIMEZONE=America/Los_Angeles

# Timeouts and pacing
# SELECTOR_TIMEOUT=8000        # selector timeout (default: 8000)
# ELEMENT_TIMEOUT=4000         # element timeout (default: 4000)
# NAV_TIMEOUT_SHORT=20000      # short navigations (default: 20000)
# SCROLL_WAIT_SECONDS=10       # dwell/scroll during tasks (default: 10)

# Lock between runs and multi-account backoff
# LOCK_STALE_TIMEOUT_MS=1800000   # lock considered stale after 30 min (default)
# ACCOUNT_BACKOFF_BASE_MS=2000    # exponential backoff base between accounts (cap 30s)

# Storage and minigames
# SESSION_STRICT_STORAGE=true     # strict localStorage allowlist (default: true)
# SURPRISE_DETAIL_FALLBACK=true   # detail fallback in the minigame (default: true)

# Diagnostics (artifacts written to scratch/)
# PW_OUTPUT_DIR=scratch
# PW_SCREENSHOT=only-on-failure   # off | on | only-on-failure
# PW_VIDEO=off                    # off | on | retain-on-failure | on-first-retry

# Heartbeat: the URL already enables it by default; false disables it via env
# HEARTBEAT_ENABLED=false

# Host label displayed in notifications (default: machine hostname)
# NOTIFY_HOST_LABEL=production-vps-server
```

> **Multi-Account Tip:** In addition to the `ALI_USER_2...20` variables, you can create an `accounts.json` file (ignored by git) containing `[{"user": "...", "password": "..."}]`. Sessions are automatically isolated per account (`session_<hash>.json`) and executed sequentially while reusing Chromium.
>
> **Security (recommended):** avoid leaving the password in plain text in `accounts.json`. Use `passwordEnv` (an environment variable name) or `passwordFile` (a `0600` file), for example: `[{"user": "a@b.com", "passwordEnv": "ALI_PW_1"}]` or `[{"user": "a@b.com", "passwordFile": "account1.pw"}]`.

Validate your configuration without opening the browser:

```bash
npm start -- --dry-run
# or with structured JSON output:
npm start -- --dry-run --json
```

Run the unified mode:

- **Linux / macOS:** `./run_all.sh`
- **Windows:** `run_all.bat` or `.\run_all.ps1`

---

## Optional Manual Login Window (2.0.0)

The default mode remains **100% headless**. When login is required — no valid session,
rejected session/reauthentication, captcha, or anti-bot block — and execution is in a
terminal with a graphical interface, the bot offers a two-option menu:

1. **Continue 100% headless** (default; `Enter` or 60s timeout)
2. **Open a window for manual login**

In option 2, you complete login/captcha/2FA **manually** in the AliExpress window. The bot
detects a strong authentication cookie (`login_aliyunid_ticket` or `xman_us_t`), saves the
session, closes the window, and resumes the rest of the execution headless. No captcha is bypassed.

The window uses a **desktop** context by default (no touch emulation), so the
slider/captcha accepts the mouse. Use `MANUAL_LOGIN_CONTEXT=mobile` if you want to reproduce
the mobile flow's Pixel 7 emulation.

**Requirements:** interactive TTY and GUI (Windows/macOS; Linux with `DISPLAY` or
`WAYLAND_DISPLAY`). In cron, Docker, CI, or SSH without a display, the menu does not appear and
the behavior is identical to version 1.x.

```env
MANUAL_LOGIN=auto                      # auto | never | always
MANUAL_LOGIN_PROMPT_TIMEOUT_MS=60000   # no menu response = option 1
MANUAL_LOGIN_TIMEOUT_MS=900000         # no login in the window = failure (no retry)
MANUAL_LOGIN_CONTEXT=desktop           # desktop (default) | mobile (Pixel 7)
```

Equivalent flags: `--manual-login` (`always`) and `--no-manual-login` (`never`).
If the window is closed or time runs out, the process exits with **code 7** (manual
intervention) and is **not** retried by `run_all.sh`. The anti-bot gate/cooldown (RGV587) is
cleared only when the session is saved successfully.

> 💡 On a VPS/cloud host without a graphical interface, perform the manual login on your local
> computer and transfer the session with `export_session.js` / `import_session.js` (see the cloud section below).

---

## Tests and Code Quality

The project uses the native Node.js test suite (`node:test`), Prettier, and ESLint 10:

```bash
# Run the unit and integration test suite
npm test

# Run the suite with a code coverage report
npm run test:coverage

# Check formatting and linter
npm run format:check
npm run lint

# Automatically format and fix linter issues
npm run format
npm run lint:fix
```

---

## Telegram Bot Notifications (100% Optional)

The automation supports sending real-time status (updated balance, streak, coins earned, completed tasks, and any errors) directly to your Telegram through a dedicated bot. The feature is **100% optional** and remains disabled by default (`TELEGRAM_ENABLED=false`).

### Step-by-Step Setup:

1. **Create the Bot on Telegram:**
   - Start a conversation with [@BotFather](https://t.me/BotFather) on Telegram.
   - Send the `/newbot` command, choose a name and a unique username (e.g. `MyAliCoinsBot`).
   - Copy the generated **HTTP API Token** (format `123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456`).
2. **Initialize the Conversation with the Bot (Prior Authorization Required):**
   - Open the dialog with the newly created bot (search for `@MyAliCoinsBot` or visit `https://t.me/MyAliCoinsBot`) and click **Start** (`/start`).
   - _Compliance note:_ Under the Telegram Bot API privacy policies, **bots are not allowed to start conversations with users**. Sending the `/start` command beforehand is essential to authorize message delivery.
3. **Get your Chat ID:**
   - Start a conversation with [@userinfobot](https://t.me/userinfobot) on Telegram.
   - The bot will reply with your numeric `Id` (e.g. `987654321`).
4. **Configure it in `credentials.env`:**

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456"
TELEGRAM_CHAT_ID="987654321"
TELEGRAM_SILENT=false

# For secondary accounts in multi-account mode (optional):
# TELEGRAM_CHAT_ID_2="111222333"
# Or configure "telegramChatId" in each object in accounts.json
```

### How to Test:

```bash
# Direct send test with the bot:
npm run notify:test

# Test with full credentials validation and notification:
npm start -- --dry-run --notify
```

See the detailed manual with images and troubleshooting at: [**`TELEGRAM.en.md`**](TELEGRAM.en.md) ([PT](TELEGRAM.md)).

---

## Cloud Execution (Oracle Cloud / AWS / VPS)

Cloud providers have datacenter IPs that AliExpress identifies as high risk, blocking new login attempts with Slide Captchas or 2FA codes.

### How to Solve It (Secure Session Delegation):

1. On your **personal computer** (residential connection where login is not challenged), run the script once and export the encrypted session:
   ```bash
   export SESSION_SECRET="your_secret_key_with_at_least_32_characters"

   # For a single account:
   node export_session.js

   # For all configured accounts (multi-account):
   node export_session.js --all

   # For a specific account:
   node export_session.js --account=2
   ```
2. On your **cloud server** (inside the `ali-coins` folder), import the session via STDIN or file:

   ```bash
   export SESSION_SECRET="your_secret_key_with_at_least_32_characters"

   # Import all accounts at once:
   node import_session.js --all

   # Or import individually via STDIN:
   node import_session.js < session_token.txt
   node import_session.js < session_token_2.txt
   # or via file:
   node import_session.js --from-file=session_token_2.txt
   ```

   > ⚠️ **Security Warning:** For security, the script refuses to accept tokens via the command line (`argv`), since that would expose credentials in the shell history (`history`) and in the system process listing (`ps aux`). The importer performs **smart auto-routing**, saving the corresponding account's session without ever overwriting other accounts.
   >
   > 🧹 **Token Hygiene:** token files are single-use. In batch import (`--all`) and in `--from-file` mode, the file is removed after a successful import (STDIN exposes no path and is not removed). Use `--keep-tokens` (or `KEEP_SESSION_TOKENS=true`) to preserve them.
   >
   > ⏳ **Token Validity:** exported tokens have an estimated validity of ~90 days (`expiresAt`). Import rejects expired tokens by default; use `--allow-expired` only if you know the cookies still work.

3. Run `./run_all.sh` in the cloud. The session will remain valid for weeks/months without requiring login.

> 💡 **Cron / Non-Interactive Execution Protection (2FA Fail-Fast):** In environments without a TTY (`!process.stdin.isTTY`), if the session expires and AliExpress requests 2FA code verification (SMS/email), the script aborts within `<5s` with **exit code 5** and sends a Telegram alert with the renewal step-by-step, preventing the scheduler from blocking on a 120s timeout.

### Monitoring Whether Cron Died (Dead Man's Switch / Heartbeat)

If your VPS goes down, the datacenter loses power, or `cron` hangs, **no log or error Telegram message is emitted**. To avoid silent failures and losing the streak:

1. Create a free check on [Healthchecks.io](https://healthchecks.io) (or a Push monitor on [Uptime Kuma](https://github.com/louislam/uptime-kuma)) configured with:
   - **Period:** `24 hours`
   - **Grace Time:** `1 hour` (alert after ~25h without a ping from the job).
   - With `START_DELAY_MAX_MS > 0`, the tolerance (**Grace Time**) must be **>= the delay ceiling** — the start ping is only sent after the wait.
2. Configure it in your `credentials.env`:
   ```env
   HEARTBEAT_URL="https://hc-ping.com/your-uuid-here"
   HEARTBEAT_TIMEOUT_MS=5000
   # HEARTBEAT_ENABLED=false   # disables via env (the URL already enables it by default)
   ```
3. The script automatically sends `/start` when starting, `/` on success with the structured report, and `/fail` on error, without ever changing the original exit code.
4. In the CLI: use `--heartbeat` to force it or `--no-heartbeat` to disable it for a specific run.
5. More details and troubleshooting at: [**`CLOUD_SESSIONS.en.md`**](CLOUD_SESSIONS.en.md).

---

## Docker Execution (Optional)

You can run the automation in an isolated Docker container (`node:22-slim`):

```bash
docker build -t ali-coins .

# Tip: create the session files on the host before mounting for at-rest persistence:
touch session.json.enc session_meta.json session.json
chmod 600 credentials.env session.json.enc session_meta.json session.json
# The container runs as appuser (UID/GID 10001): if the process is executed without --user,
# adjust the ownership of the mounted files so appuser can read/write them:
chown 10001:10001 credentials.env session.json.enc session_meta.json session.json

docker run --rm \
  -v $(pwd)/credentials.env:/app/credentials.env:ro \
  -v $(pwd)/session.json.enc:/app/session.json.enc \
  -v $(pwd)/session_meta.json:/app/session_meta.json \
  -v $(pwd)/session.json:/app/session.json \
  -e NOTIFY_HOST_LABEL="my-server" \
  ali-coins
```

- **Hosts with 1 GB of RAM (Oracle Free Tier, t2/t3.micro, DO):** recommend 1–2 GB of swap on the host (`fallocate -l 2G /swapfile`) and limit the container: `--init --pids-limit=256 --shm-size=256m --memory=768m --memory-swap=1536m`. Chromium's low-consumption flags are already applied by default both in Docker and outside it (`CHROMIUM_LOW_MEMORY=true`), `NODE_OPTIONS="--max-old-space-size=256"` prevents heap spikes, `NODE_COMPILE_CACHE` speeds up startup (V8 bytecode cache in `/tmp`), and `SCRYPT_N=32768` reduces the scrypt peak from ~134 MB to ~33 MB. Details in [`CLOUD_SESSIONS.en.md`](CLOUD_SESSIONS.en.md) and in the OS-specific manuals ([`INSTALL_LINUX.en.md`](INSTALL_LINUX.en.md), [`INSTALL_WINDOWS.en.md`](INSTALL_WINDOWS.en.md), [`INSTALL_MACOS.en.md`](INSTALL_MACOS.en.md)).
- **Node Heap/OOM in the unified flow (outside Docker):** the `run*.sh` scripts detect the host RAM: 256 MB on small machines, 384 MB (3–6 GB), or 512 MB (above 6 GB). This avoids the `JavaScript heap out of memory` error from check-in + tasks in a single process. To force a ceiling, use `ALI_HEAP_MB=512 ./run_all.sh`; an exported `NODE_OPTIONS` takes precedence. Inside the container the ceiling remains 256 MB because of the `memory: 768M` limit; if you run the unified flow in a container with more tasks, increase `NODE_OPTIONS` and the memory limit together.
- **Non-root user:** The container runs by default as the dedicated system user `appuser` (UID/GID 10001).
- **Running with the host's `--user <uid>:<gid>`:** If you specify the host user to preserve the mounted files' permissions, mount `/etc/passwd` and `/etc/group` read-only so Node's user resolution (`os.userInfo()` via libuv `uv_os_get_passwd`) does not raise an `ENOENT` error:
  ```bash
  docker run --rm \
    -u $(id -u):$(id -g) \
    -v /etc/passwd:/etc/passwd:ro \
    -v /etc/group:/etc/group:ro \
    -v $(pwd)/credentials.env:/app/credentials.env:ro \
    -v $(pwd)/session.json.enc:/app/session.json.enc \
    -v $(pwd)/session_meta.json:/app/session_meta.json \
    -v $(pwd)/session.json:/app/session.json \
    -e NOTIFY_HOST_LABEL="my-server" \
    ali-coins
  ```
- **Compose and production wrapper:** use `docker-run.example.sh` (cron wrapper with peak memory/PID measurement) or `docker-compose.yml` (declarative limits: `shm_size: 256m`, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, 768M memory) to avoid repeating the flags manually.
- **At-Rest Persistence (`session.json.enc`):** With `ENCRYPT_LOCAL_SESSION=true` (default since 0.8), AliExpress saves the encrypted session in `session.json.enc` and metadata in `session_meta.json`. Mounting these files ensures the session persists between runs of the ephemeral container (`--rm`).
- **Host Identification in Telegram (`NOTIFY_HOST_LABEL`):** In disposable containers, the default hostname is the random container ID. Pass `-e NOTIFY_HOST_LABEL="my-server"` or the `--hostname my-server` flag so notifications correctly identify your server.
- The `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` variable ensures browsers are shared and cached.

---

## Security and Permissions

- **At-Rest Encryption (`session.json.enc`):** Local sessions are written encrypted with AES-256-GCM v3 (`scrypt` + random salt) when `SESSION_SECRET` is configured (`ENCRYPT_LOCAL_SESSION=true`). Includes transparent reading with fallback for migrating legacy `session.json`, automatic migration of `v1`/`v2` tokens to `v3`, and smooth key rotation via `SESSION_SECRET_OLD`.
- **Session Key Rotation:** At-rest rotation can be performed manually via the CLI:
  ```bash
  export SESSION_SECRET_OLD="old_key_with_more_than_32_chars"
  export SESSION_SECRET_NEW="new_secret_key_with_more_than_32_chars"
  node export_session.js --rotate --new-secret-from-env=SESSION_SECRET_NEW
  ```
  The previous session is decrypted with `SESSION_SECRET_OLD`, validated, saved as a secure backup in `scratch/session.bak-<timestamp>.json.enc` (0o600), and re-encrypted with the new key.
- **Backup Retention Policy (`scratch/`):** Automatic cleanup (`pruneSessionBackups`) of backups older than `SESSION_BACKUP_RETENTION_DAYS` (default: 7 days), triggered during rotation, saving, or clearing sessions.
- **Strict 0o600 Permissions:** All secrets files (`credentials.env`, `session.json`, `session.json.enc`, `session_meta.json`, `session_token.txt`, backups, and dumps) are saved and kept exclusively with `0o600` permission.
- **AES-256-GCM v3 Encryption:** Exports and at-rest data use key derivation via `scrypt` with a dynamic random 16-byte salt, explicit parameters, and `SESSION_SECRET` (minimum 32 characters). Compatible with legacy `v1` and `v2` tokens.
- **DNS Pinning (anti-SSRF/rebinding):** webhooks and heartbeat revalidate **every redirect hop**, and the connection uses the **validated IP** (pinned lookup via `undici`) — a DNS with TTL 0 cannot return a public IP during the check and a private/metadata IP during the connection. Without `undici` installed, traditional DNS validation is maintained (graceful degradation).
- **Browser Isolation:** Chromium's `--no-sandbox` flag is restricted exclusively to execution as root (UID 0) or CI, keeping the sandbox enabled for regular users.
- **Log Redaction:** Structured logs via `pino` automatically redact passwords, tokens, cookies, and sensitive URL parameters.

---

## Branch Protection and Continuous Integration (CI)

- **Mandatory Validation:** The `main` branch requires all tests on Linux, macOS, and Windows, as well as formatting and linter checks, to pass successfully in the `CI` workflow before any merge.
- **Supply-Chain Gate in Dependabot:** Automated dependency PRs (patch/minor) have a security gate that waits for the successful completion of the `CI` workflow on the commit SHA before authorizing auto-merge (`squash`).
