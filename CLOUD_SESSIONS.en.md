# Advanced Guide: Running on Cloud Servers and Session Management

> 🌐 **Languages:** [Português](CLOUD_SESSIONS.md) | [English](CLOUD_SESSIONS.en.md)

> ℹ️ English translation of the canonical Portuguese documentation. If there is any divergence, the Portuguese version prevails.

This guide explains in detail how AliExpress security mechanisms work in cloud environments (Oracle Cloud, AWS, Google Cloud, DigitalOcean, Hetzner, etc.) and the recommended **session delegation** method (local generation and export to the server).

> [!TIP]
> **Assisted manual login (2.0.0):** on a computer with a graphical interface, run
> `node collect.js` (or `./run_all.sh`) and choose **option 2** when the menu appears.
> The bot opens an AliExpress window for you to complete login/captcha/2FA, saves the
> session automatically, and resumes headless. On a VPS/cron without a GUI the menu does not appear;
> in that case use the export/import flow described below.

---

## Table of Contents

1. [The Datacenter IP Challenge (Baxia Anti-Bot)](#1-the-datacenter-ip-challenge-baxia-anti-bot)
2. [Why Does Authentication Work on the PC but Fail in the Cloud?](#2-why-does-authentication-work-on-the-pc-but-fail-in-the-cloud)
3. [The Solution: Session Delegation (Generate Locally -> Export to Cloud)](#3-the-solution-session-delegation-generate-locally---export-to-cloud)
4. [Methods to Transfer the Session](#4-methods-to-transfer-the-session)
   - [Method 1: Automatic Utilities (`export_session.js` and `import_session.js`)](#method-1-automatic-utilities-export_sessionjs-and-import_sessionjs)
   - [Method 2: Direct Transfer via SCP](#method-2-direct-transfer-via-scp)
   - [Method 3: Direct Creation via Terminal (Here-Doc)](#method-3-direct-creation-via-terminal-here-doc)
5. [Session Duration and Renewal](#5-session-duration-and-renewal)
6. [Switching Accounts in the Cloud](#6-switching-accounts-in-the-cloud)
7. [Optimizations for Low-Memory VPS (512 MB - 1 GB RAM)](#7-optimizations-for-low-memory-vps-512-mb---1-gb-ram)
8. [Cron Scheduling with Telegram Notifications](#8-cron-scheduling-with-telegram-notifications)
9. [Periodic Secret Rotation and Backup Pruning](#9-periodic-secret-rotation-and-backup-pruning)
10. [Monitoring Whether Cron Died (Dead Man's Switch / Heartbeat)](#10-monitoring-whether-cron-died-dead-mans-switch--heartbeat)
11. [Cron Log Hygiene and Rotation (logrotate)](#11-cron-log-hygiene-and-rotation-logrotate)

---

## 1. The Datacenter IP Challenge (Baxia Anti-Bot)

AliExpress (Alibaba Group) employs a corporate risk control and anti-automation protection system called **Baxia**. This system evaluates the reputation score of each connection:

- **Datacenter IP Ranges:** Cloud servers such as Oracle Cloud, AWS EC2, DigitalOcean, or Linode have public ASN blocks cataloged as datacenters/hosting.
- **New Login Detection:** When a login form (username and password) is submitted from a cloud IP in headless mode (without a graphical interface), Baxia interrupts the flow by requiring:
  1. **High-Resolution Slide Captcha:** A slider control with mouse telemetry, acceleration, and human entropy verification.
  2. **Two-Step Verification (2FA):** Sending a 6-digit code to the email or SMS registered on the account.

If these challenges are not solved, AliExpress does not issue the master authentication cookie (`xman_us_t`). As a consequence:

- The check-in does not identify the account (`0 coins`, streak `N/D`).
- The tasks panel ("Earn more coins") does not load or open the drawer.

> [!IMPORTANT]
> **Automatic Login Failure Detection:**
> If the script cannot simultaneously obtain the streak of days, the daily check-in coins, and the account's total balance, it explicitly alerts `[ERRO AO EFETUAR O LOGIN]`, purges the invalid session, and stops the routine immediately to avoid runs with zeroed data or hangs in the tasks panel.

---

## 2. Why Does Authentication Work on the PC but Fail in the Cloud?

1. **Residential IPs:** Your residential internet connection (common broadband providers) has a high reputation. AliExpress rarely challenges credential submissions from personal computers.
2. **Cookie Reuse:** AliExpress **does not block** access to the coin center from a datacenter IP if the request already contains a previously authenticated session (cookies `xman_us_t`, `aep_usuc_f`, etc.).
3. **Conclusion:** Simply log in once on your personal computer and transfer the generated session files to your cloud server.

---

## 3. The Solution: Session Delegation (Generate Locally -> Export to Cloud)

The ideal workflow to keep the automation running 24/7 in the cloud is:

```mermaid
flowchart LR
    A[Your Personal Computer\nResidential IP] -->|1. Successfully logs in| B(session.json generated)
    B -->|2. Exports session| C{Transfer}
    C -->|3. Imports session| D[Cloud Server\nOracle Cloud / AWS / VPS]
    D -->|4. Runs 24/7 via Cron| E[Check-in + Daily Tasks]
```

1. **On the personal computer:** Run the script normally (`./run_all.sh` on Linux/macOS or `run_all.bat` on Windows). The session will be authenticated and saved in `session.json`.
2. **Transfer:** Send the session files to the `ali-coins` folder on your cloud server.
3. **On the cloud server:** Run `./run_all.sh`. The script will detect the valid session, perform the cookie handshake, and run daily without ever asking for a password or triggering captchas.

---

## 4. Methods to Transfer the Session

### Method 1: Automatic Utilities (`export_session.js` and `import_session.js`)

The project includes dedicated scripts for exporting and importing encrypted sessions with **AES-256-GCM** (using `scrypt` for key derivation and an authentication tag):

#### A. Export on the Personal Computer (where the login was performed)

Set the `SESSION_SECRET` variable (minimum 32 characters) in `credentials.env` or in the environment:

- **Export all active accounts (default in a multi-account environment):**

  ```bash
  node export_session.js
  # or explicitly:
  node export_session.js --all
  ```

  The script will export all configured accounts, generating individual tokens:
  - Account 1 -> `session_token.txt`
  - Account 2 -> `session_token_2.txt`
  - Account N -> `session_token_N.txt`

- **Export only a specific account:**
  ```bash
  # By numeric index (1, 2, ...):
  node export_session.js --account=2

  # Or by the account email:
  node export_session.js --account="user@gmail.com"
  ```

The encrypted tokens (format `v3:N:r:p:salt:iv:tag:ciphertext` or legacy `v2`/`v1`) are saved with restricted `0o600` permissions. For security against leaks on screens and logs, the terminal displays only the SHA-256 fingerprint and the file size. (If you need to display the full token on screen, add `--show-token`).

#### B. Import on the Cloud Server (inside `~/ali-coins`)

Transfer the generated token files to the project folder on the server:

- **Import ALL accounts at once:**

  ```bash
  node import_session.js --all
  ```

  The utility processes all `session_token*.txt` files in the directory, decrypts them with your `SESSION_SECRET`, recognizes each account by `meta.user`, and writes to the corresponding isolated files (`session.json.enc`, `session_<hash>.json.enc`, etc.), applying `0o600` to all of them.

  > 🧹 **Token Hygiene:** by default, each `session_token*.txt` is **securely removed after a successful import** (the token is single-use). If you need to preserve them (e.g., replicate the import on another host), use `node import_session.js --all --keep-tokens` or set `KEEP_SESSION_TOKENS=true`.

- **Import individually (via STDIN - recommended):**

  ```bash
  # Account 1:
  node import_session.js < session_token.txt

  # Account 2:
  node import_session.js < session_token_2.txt
  ```

- **Import individually (via file or explicit flag):**
  ```bash
  node import_session.js --from-file=session_token_2.txt
  # or specifying the account:
  node import_session.js --account=2 < session_token_2.txt
  ```

> 🔒 **Smart Auto-Routing and Multi-Account Protection:**
> Even if you do not specify `--account`, the importer analyzes the email embedded in the encrypted token and compares it with the accounts registered in the remote server's `credentials.env`. If the token belongs to Account 2, it will automatically save it to `session_<hash>.json.enc`, **never overwriting or corrupting Account 1's session**.
>
> 🔒 **Shell Security:** The script refuses tokens directly in `process.argv` to prevent credential leaks in the shell history (`~/.bash_history`) or in the system process listing (`ps aux`). The token buffer memory is zeroed right after decryption.

---

### Method 2: Direct Transfer via SCP

If you have SSH access configured from your computer to the server:

1. In your personal computer's terminal, inside the `ali-coins` folder:
   ```bash
   scp session.json session_meta.json ubuntu@<SERVER_IP>:~/ali-coins/
   ```
   _(Replace `ubuntu` and `<SERVER_IP>` with your virtual machine's access details.)_

---

### Method 3: Direct Creation via Terminal (Here-Doc)

If you prefer not to use tokens or SCP, you can paste the files directly into the cloud SSH terminal using `cat << 'EOF'`:

1. In the cloud terminal:

   ```bash
   cat << 'EOF' > session_meta.json
   {
     "user": "your_email@gmail.com",
     "savedAt": "2026-09-10T11:00:00.000Z"
   }
   EOF
   ```

2. Open the `session.json` generated on your local machine with a text editor, copy its contents, and paste them on the server:
   ```bash
   cat << 'EOF' > session.json
   { ... paste the contents of the local session.json here ... }
   EOF
   ```

---

### Method 4: Code Synchronization via rsync (update the VM without secrets)

To send the project code (after a `git pull` or release) to the VM without
overwriting sessions, credentials, and the cron wrapper:

```bash
rsync -a --delete \
  --exclude '/.git' --exclude '/node_modules' --exclude '/libs/extracted' \
  --exclude '/credentials.env' --exclude '/credentials.env*' \
  --exclude '/session*' --exclude '/session_token*' --exclude '/accounts.json' \
  --exclude '/scratch/' --exclude '/*.log' --exclude '/*.lock' \
  --exclude '/docker-run.sh' --exclude '/docker-run.sh.bak*' \
  --exclude '/github_token.env' --exclude '/*.png' --exclude '/*.zip' \
  ./ ubuntu@<SERVER_IP>:~/ali-coins/
```

> **Watch the anchored excludes:** always use the leading slash (e.g. `/session*`).
> Patterns without `/` (e.g. `--exclude 'session*'`) match files in **any**
> directory and silently exclude `libs/session.js` and `tests/session*.js`,
> leaving the VM running an old version of the code. After syncing, confirm that
> the `docker-run.sh` wrapper and the `session*.json.enc` files are still at the destination and
> rebuild the image (`docker build -t ali-coins:latest ~/ali-coins`).

---

## 5. Session Duration and Renewal

- **Cookie Validity:** AliExpress session cookies (`xman_us_t`, `aep_usuc_f`, `xman_t`) have a validity ranging from **30 to 90 days**.
- **Automatic Renewal:** Every time the script runs daily via Cron, AliExpress automatically renews the expiration date of the active cookies.
- **When will the procedure need to be repeated?** Only if you change the account password on AliExpress or explicitly log out of all sessions in the site's security settings.

> [!WARNING]
> **Expired Imported Session Detection and Alert:**
> If the session running on the remote server expires or is invalidated by AliExpress, the application automatically detects that it was received from another host (`node import_session.js`). The system records a clear warning in the logs and sends a detailed alert via the Telegram bot suggesting renewal:
>
> 1. Run `node export_session.js` on the source machine.
> 2. Import the updated token on the remote server with `node import_session.js < session_token.txt`.

> [!NOTE]
> **Estimated expiry vs. real cookies (2.5.0):** the `expiresAt` stored in
> `session_meta.json` is only an export estimate. `--check-session` uses the real validity
> of `xman_us_t`/`login_aliyunid_ticket` cookies as the source of truth and does not
> invalidate the session just because the estimate has passed. When that happens, the
> result includes `warnings: [{ code: "estimated_expiry_passed" }]` and the summary shows
> `avisos=estimated_expiry_passed`; renew the session preventively if the cookies are also
> close to expiry.

> [!NOTE]
> **In-page reauthentication prompt (since 1.6.1):** if AliExpress asks for **only
> the password** on the same page (without redirecting to a login URL), the automation detects
> the prompt by the visible password field and attempts authentication automatically — including
> in cron runs. On cloud IPs, the slider/captcha challenge may prevent
> login; in that case, renew locally (residential network) and import the session.

---

## 6. Switching Accounts in the Cloud

If you decide to change the user in the server's `credentials.env`:

1. Also change `credentials.env` on your local machine.
2. Run `./run_all.sh` on the local machine to generate the new session for the new account.
3. Export the new session to the server using `node export_session.js` and `node import_session.js`.

> [!IMPORTANT]
> The script has built-in protection: if the user configured in `credentials.env` differs from the user registered in the active session (`session_meta.json`), the script will warn that the account has changed and will require the corresponding new session to avoid collecting coins on the wrong account.

---

## 7. Optimizations for Low-Memory VPS (512 MB - 1 GB RAM)

On free Oracle Cloud instances or compact VPS servers with 1 GB of RAM, the Playwright Chromium browser may be terminated by the operating system (_OOM Killer_) if free memory is insufficient while loading pages with many ads or products.

To avoid memory failures:

1. **Create a 2 GB Swap memory file:**

   ```bash
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

2. **Verify that Swap is active:**

   ```bash
   free -h
   ```

   The `Swap:` line should indicate approximately `2.0Gi` available.

3. **Limit the container and size `/dev/shm` in the Docker run:**

   ```bash
   docker run --rm --init --pids-limit=256 \
     --shm-size=256m \
     --memory=768m --memory-swap=1536m \
     -v "$PWD/credentials.env:/app/credentials.env:ro" \
     -v "$PWD/scratch:/app/scratch" \
     ali-coins:latest node all.js
   ```

   - `--memory=768m --memory-swap=1536m`: the container can use up to 768 MB of RAM + 768 MB of swap, leaving ~200 MB for the OS — prevents the OOM Killer from taking down the main process.
   - `--shm-size=256m`: headroom for `/dev/shm`. With 128 MB or more free, Chromium uses tmpfs in RAM; the `--disable-dev-shm-usage` flag is only applied automatically when `/dev/shm` is small (e.g., the default 64 MB container).
   - `--init` and `--pids-limit=256`: prevent accumulation of Chromium child processes.
   - `NODE_COMPILE_CACHE=/tmp/node-compile-cache` (already included in the image): with `/tmp` on tmpfs, the V8 bytecode cache speeds up process startup and the healthcheck.
   - A ready-made cron wrapper example, with peak memory measurement, is in
     [`docker-run.example.sh`](docker-run.example.sh).
   - Declarative alternative: [`docker-compose.yml`](docker-compose.yml) already includes the same
     limits (`shm_size: 256m`, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, 768M).
   - **Per-environment lockfile:** the lock lives in the project directory (`ali-coins-<uid>.lock`).
     Inside the container it lives in `/app` (ephemeral), so **native runs on the host
     and runs via Docker do not share the same lock** — avoid running both
     simultaneously for the same account.

4. **Reduce the `scrypt` cost on 1 GB hosts:**

   The default `SCRYPT_N=131072` (2¹⁷) allocates ~134 MB at the key derivation peak. On small VPS
   instances, use `SCRYPT_N=32768` (~33 MB) or `SCRYPT_N=16384` (~16 MB) in `credentials.env`:

   ```env
   SCRYPT_N=32768
   ```

5. **Low-consumption flags are already enabled by default:**

   Chromium is started with `--disable-gpu`, `--disable-software-rasterizer`,
   `--renderer-process-limit=1`, `--js-flags=--max-old-space-size=128`, and
   `--disk-cache-size=10485760`. The `--no-zygote` flag is added only when the sandbox
   is disabled (`NO_SANDBOX=true`, root, or CI) — Chromium itself refuses the
   `--no-zygote` + sandbox combination, so in a container with an active sandbox it is omitted
   automatically. To disable the set (roomy hosts/troubleshooting), set
   `CHROMIUM_LOW_MEMORY=false`. On tight hosts, `PW_TRACE=off` also reduces CPU/disk
   during execution (failure screenshots are still generated).

6. **Native execution outside Docker on 1 GB servers:**

   All the Chromium low-consumption flags above and the `SCRYPT_N` relief work
   **natively and identically outside Docker** (via `./run_all.sh` or `npm start`).
   To also limit the Node.js heap outside the container, export it in the shell or add it to `crontab -e`:

   ```cron
   NODE_OPTIONS="--max-old-space-size=256"
   0 4 * * * cd /home/ubuntu/ali-coins && ./run_all.sh >> cron.log 2>&1
   ```

---

## 8. Cron Scheduling with Telegram Notifications

To keep collection 100% autonomous on the cloud server, add an entry to the user's `crontab`:

```bash
crontab -e
```

Add the line for daily execution (example: every day at 04:15 AM):

```bash
# Runs daily at 04:15 AM with a Telegram notification
15 4 * * * cd /home/ubuntu/ali-coins && /usr/bin/node all.js >> /home/ubuntu/ali-coins/cron.log 2>&1
```

> [!IMPORTANT]
> **Avoid the day-rollover window (`00:00–01:30` in `America/Los_Angeles`):** in that
> range the coin center is unstable — the check-in click may not be confirmed
> by the UI, and the "Browse surprise items" task often fails without progress. Prefer scheduling
> ~3h after the rollover (e.g. `09:30–11:00 UTC` = `06:30–08:00` in `America/Sao_Paulo`).
> Schedule at a **fixed time** and let the app handle randomization
> (`START_DELAY_MIN_MS`/`START_DELAY_MAX_MS` in `credentials.env`; e.g. `0` and `5400000`
> for up to 90 min) — it is portable across cron/launchd/Scheduler/Docker, does not delay on
> `--dry-run`, and can be skipped with `--no-delay`.

> [!TIP]
>
> - If you configured `TELEGRAM_ENABLED=true` in `credentials.env`, the notification will be sent automatically on each run (success, already collected, or any error).
> - To avoid being woken up at night, enable `TELEGRAM_SILENT=true` in `credentials.env` so messages arrive without a sound alert.
> - If you want to disable notifications specifically in cron, add the `--no-notify` flag.
> - **Startup warning:** Make sure you have started the conversation with your bot by sending `/start` before the first run, because the Telegram API does not authorize bots to start conversations with users.
> - See [**`TELEGRAM.md`**](TELEGRAM.md) for the detailed bot creation guide and troubleshooting.

---

## 9. Periodic Secret Rotation and Backup Pruning

For compliance with security best practices on cloud servers, it is recommended to periodically rotate the at-rest encryption keys (`session.json.enc`):

### 1. Monthly Rotation via Cron

You can schedule session key rotation in `crontab` (for example, on the first day of each month at 03:00 AM):

```bash
# Monthly rotation scheduled on the 1st of each month at 03:00
0 3 1 * * cd /home/ubuntu/ali-coins && /usr/bin/node export_session.js --rotate --new-secret-from-env=SESSION_SECRET_NEW >> /home/ubuntu/ali-coins/rotation.log 2>&1
```

### 2. Backups and Automatic Retention (Pruning)

- On each rotation, an encrypted backup of the previous session is written to `scratch/session.bak-<timestamp>.json.enc` with strict `0o600` permission.
- The **automatic pruning** mechanism discards backups older than 7 days of retention (configurable via `SESSION_BACKUP_RETENTION_DAYS` (diagnostics use `DIAGNOSTICS_RETENTION_DAYS`)), preventing the accumulation of residual files on the VPS disk.

---

## 10. Monitoring Whether Cron Died (Dead Man's Switch / Heartbeat)

If your VPS is restarted, the datacenter loses power, the network interface hangs, or the `cron` service is accidentally disabled, **no script will run** and, consequently, **no error log or Telegram message will be sent** (silent failure).

To prevent irreversible streak loss due to silent inactivity, the project has native integration with **Dead Man's Switch** services (such as [Healthchecks.io](https://healthchecks.io) or Push monitors from [Uptime Kuma](https://github.com/louislam/uptime-kuma)).

### How It Works

1. **Job Start (`/start`):** The script sends a request indicating that execution has started.
2. **Successful Completion:** Sends a success signal with the structured report attached.
3. **Failure (`/fail`):** Sends a failure signal with error details (without changing the process's original exit code).
4. **Alert for Missing Ping:** If the external service does not receive any ping within the expected window (e.g. 24h + 1h tolerance), it will send an alert directly to you (via Email, Telegram, Discord, Pushover, or SMS).

### Step-by-Step Configuration

1. Create a free account on [healthchecks.io](https://healthchecks.io) (or access your Uptime Kuma instance).
2. Create a new check with the recommended parameters:
   - **Period:** `24 hours`
   - **Grace Time:** `1 hour`
   - _(Result: you will be alerted if ~25 hours pass without the job running)._
3. Copy the generated unique URL (example: `https://hc-ping.com/your-uuid-here`).
4. Configure it in the server's `credentials.env` file:
   ```env
   HEARTBEAT_URL="https://hc-ping.com/your-uuid-here"
   HEARTBEAT_TIMEOUT_MS=5000
   ```
5. _(Optional)_ In the CLI, you can control sending using the `--heartbeat` or `--no-heartbeat` flags:
   ```bash
   npm start -- --heartbeat
   npm start -- --no-heartbeat
   ```

### Validation (Dry-Run vs Real Run)

- **Dry-Run mode (`npm start -- --dry-run`):** Only validates syntax and theoretical connectivity without sending requests to the monitor.
- **Real run with Heartbeat:**
  ```bash
  ./run_all.sh
  ```
  The log will record: `heartbeat: ok` with the masked token (e.g. `https://hc-ping.com/a1b2***7890/start`), without exposing credentials.

### Troubleshooting

- **Check Failing / Down Alert:**
  - Verify that the VPS has internet access by running: `curl -I https://hc-ping.com`.
  - Verify that outbound ports `443` (HTTPS) are allowed in the cloud firewall policy (Security Lists / Security Groups).
  - Confirm that the Linux `cron` service is running with `systemctl status cron` (or `crond`).
- **Using HTTP:** Always use `https://` to ensure your monitor UUID travels encrypted.

---

## 11. Cron Log Hygiene and Rotation (logrotate)

When scheduling periodic execution with log redirection (for example: `0 8 * * * cd /path/ali-coins && ./run_all.sh >> cron.log 2>&1`), the `cron.log` file will accumulate output over time.

To avoid uncontrolled disk growth without changing the application's logging behavior, we recommend configuring the native system utility **`logrotate`** with the `copytruncate` directive.

> [!NOTE]
> `copytruncate` is essential for scripts scheduled via shell redirect (`>>`), as it allows the process to continue writing to the file without losing the pointer or causing file descriptor hangs.

### Recommended Configuration File

Example configuration to keep up to 4 weeks of logs with weekly rotation and gzip compression:

```text
/home/your_user/ali-coins/*.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

### Step-by-Step Installation (Linux)

1. Create the definition file at `/etc/logrotate.d/ali-coins` (replacing it with the absolute path obtained with `pwd`):

   ```bash
   sudo tee /etc/logrotate.d/ali-coins << 'EOF'
   /home/your_user/ali-coins/*.log {
       weekly
       rotate 4
       compress
       delaycompress
       missingok
       notifempty
       copytruncate
   }
   EOF
   ```

2. Adjust the configuration file permissions:

   ```bash
   sudo chmod 644 /etc/logrotate.d/ali-coins
   ```

3. Validate the syntax and test execution in simulation mode (dry-run):
   ```bash
   sudo logrotate -d /etc/logrotate.d/ali-coins
   ```

The Linux system will run rotation automatically in the daily cron (`/etc/cron.daily/logrotate`), keeping disk consumption controlled and predictable.

---

[Back to the Main README](README.en.md)
