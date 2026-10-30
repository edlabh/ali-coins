# Detailed Linux Installation Guide (Ubuntu 22.04 LTS / 24.04 LTS and Debian)

> 🌐 **Languages:** [Português](INSTALL_LINUX.md) | [English](INSTALL_LINUX.en.md)

> ℹ️ English translation of the canonical Portuguese documentation. If there is any divergence, the Portuguese version prevails.

This manual was created to guide you step by step through the complete installation of the **AliExpress Coin Collector & Task Runner** in any Linux environment, covering everything from desktops to headless cloud servers (such as Oracle Cloud, AWS EC2, DigitalOcean, Google Cloud, etc.).

> [!NOTE]
> **What's new in 2.5.0:** installation is unchanged (Node.js 22 + Playwright). The release
> adds `run_metrics` with `runId`, stable i18n IDs, ~48% lighter boot on `--help`/dry-run,
> `--check-session` warnings for `expiresAt`, CI gates and the `npm run bench` benchmark.
> See [README.en.md](README.en.md), [OBSERVABILITY.en.md](OBSERVABILITY.en.md) and
> [PERFORMANCE.en.md](PERFORMANCE.en.md).

---

## Table of Contents

1. [Minimum Requirements](#1-minimum-requirements)
2. [Method A: Automatic Installation (Recommended - 1 Command)](#2-method-a-automatic-installation-recommended---1-command)
3. [Method B: Detailed Step-by-Step Manual Installation](#3-method-b-detailed-step-by-step-manual-installation)
   - [Step 1: Cleaning Up Old Node.js Versions](#step-1-cleaning-up-old-nodejs-versions)
   - [Step 2: Installing Node.js 22 LTS](#step-2-installing-nodejs-22-lts)
   - [Step 3: Clone the Project and Permissions](#step-3-clone-the-project-and-permissions)
   - [Step 4: Installing npm Dependencies](#step-4-installing-npm-dependencies)
   - [Step 5: Installing Chromium and Native OS Dependencies](#step-5-installing-chromium-and-native-os-dependencies)
   - [Step 6: Quick Chromium Validation](#step-6-quick-chromium-validation)
   - [Step 7: Credential Configuration](#step-7-credential-configuration)
   - [Step 8: First Run](#step-8-first-run)
4. [Configuring the Daily Schedule (Crontab)](#4-configuring-the-daily-schedule-crontab)
5. [Troubleshooting Common Issues](#5-troubleshooting-common-issues)

---

## 1. Minimum Requirements

- **Distribution:** Ubuntu 20.04 LTS, Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, or Debian 11/12 (x86_64 or ARM64/aarch64 architecture).
- **Node.js:** Version 22 LTS or higher (`node >= 22`).
- **Hardware Resources:** Minimum of 1 vCPU and 1 GB of RAM (for servers with 1 GB of RAM or less, enabling 1 GB or 2 GB of Swap memory is recommended).
- **Access:** `sudo` privileges to install system libraries.

---

## 2. Method A: Automatic Installation (Recommended - 1 Command)

If you have already cloned the repository, simply run the automated script included in the project root:

```bash
cd ali-coins
chmod +x setup_linux.sh
./setup_linux.sh
```

The automatic installer performs the following on its own:

1. Installation of system utilities (`curl`, `git`, `ca-certificates`, `gnupg`);
2. Installation of **Node.js 22 LTS** if the system does not have it or has a version lower than 22;
3. Running `npm install`;
4. Downloading the Chromium browser via Playwright;
5. Installing all native OS libraries specific to your distribution;
6. Configuring the execution permissions of the `.sh` scripts;
7. Creating the `credentials.env` configuration file with automatic generation and pre-configuration of the `SESSION_SECRET` key (AES-256).

After completion, simply edit your credentials with `nano credentials.env` (the cryptographic key is already pre-configured) and run `./run_all.sh`.

---

## 3. Method B: Detailed Step-by-Step Manual Installation

Follow the steps below if you want full control over every package installed on your operating system.

### Step 1: Cleaning Up Old Node.js Versions

On default Ubuntu 22.04 LTS, the Canonical repository installs Node.js `v12.22.9`. The project and Playwright require **Node.js 22 LTS or higher**. If you have previously installed the default apt package, remove it first:

```bash
sudo apt-get remove -y nodejs npm
sudo apt-get autoremove -y
```

### Step 2: Installing Node.js 22 LTS

#### Option 1: Via the Official NodeSource Repository (Recommended for servers/VPS)

Installs the latest stable Node.js 22 LTS binary and the updated npm:

```bash
# 1. Update the apt index and install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

# 2. Download and register the official NodeSource repository for Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# 3. Install Node.js and npm
sudo apt-get install -y nodejs

# 4. Validate that the installation succeeded (should display v22.x.x and npm 10+)
node -v
npm -v
```

#### Option 2: Via NVM (Node Version Manager)

If you prefer to manage versions in user space without installing global system packages:

```bash
# Download and install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load NVM into the current session
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install and pin Node.js 22 LTS
nvm install 22
nvm use 22
nvm alias default 22
```

### Step 3: Clone the Project and Permissions

```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
chmod +x *.sh
```

### Step 4: Installing npm Dependencies

In the `ali-coins` folder root:

```bash
npm install
```

This installs the locked Playwright version declared in `package.json` (`^1.48.0`).

### Step 5: Installing Chromium and Native OS Dependencies

Playwright manages its browsers in isolation in the `~/.cache/ms-playwright/` directory.

1. **Download the Chromium binary:**

   ```bash
   npx playwright install chromium
   ```

2. **Install the system dependencies:**
   Even when running in headless mode (without a graphical interface), Chromium depends on several native libraries for image decoding, audio, networking, and X11 rendering.

   - **Playwright's Official Automated Method (Easiest):**

     ```bash
     sudo npx playwright install-deps chromium
     ```

   - **Manual Method via apt-get:**
     If you prefer to install package by package or are customizing a Docker/minimal image:

     **For Ubuntu 22.04 LTS (Jammy) and Debian 11/12:**

     ```bash
     sudo apt-get update && sudo apt-get install -y \
       libasound2 \
       libatk-bridge2.0-0 \
       libatk1.0-0 \
       libatspi2.0-0 \
       libcairo2 \
       libcups2 \
       libdbus-1-3 \
       libdrm2 \
       libgbm1 \
       libglib2.0-0 \
       libnspr4 \
       libnss3 \
       libpango-1.0-0 \
       libx11-6 \
       libxcb1 \
       libxcomposite1 \
       libxdamage1 \
       libxext6 \
       libxfixes3 \
       libxkbcommon0 \
       libxrandr2 \
       fonts-liberation \
       fonts-noto-color-emoji
     ```

     **For Ubuntu 24.04 LTS (Noble):**
     _(Note: On Ubuntu 24.04, several packages were renamed with the `t64` suffix due to the Linux kernel 64-bit transition):_

     ```bash
     sudo apt-get update && sudo apt-get install -y \
       libasound2t64 \
       libatk-bridge2.0-0t64 \
       libatk1.0-0t64 \
       libatspi2.0-0t64 \
       libcairo2 \
       libcups2t64 \
       libdbus-1-3 \
       libdrm2 \
       libgbm1 \
       libglib2.0-0t64 \
       libnspr4 \
       libnss3 \
       libpango-1.0-0 \
       libx11-6 \
       libxcb1 \
       libxcomposite1 \
       libxdamage1 \
       libxext6 \
       libxfixes3 \
       libxkbcommon0 \
       libxrandr2 \
       fonts-liberation \
       fonts-noto-color-emoji
     ```

### Step 6: Quick Chromium Validation

To be 100% sure that the browser starts perfectly without missing dynamic library errors:

```bash
node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('✅ Chromium started successfully on Linux!'); await b.close(); })();"
```

If the command prints `✅ Chromium started successfully on Linux!`, your environment is 100% ready.

### Step 7: Credential Configuration

1. Copy the example file and restrict permissions to your user (`0o600`):

   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```

2. Open the file in your preferred editor (`nano credentials.env`):

   ```env
   # AliExpress credentials (required)
   # Always keep them inside double quotes. Passwords with #, spaces, or ! without quotes
   # are silently truncated. E.g.: ALI_PASSWORD="abc#123!"
   ALI_USER="your_email_or_phone"
   ALI_PASSWORD="your_aliexpress_password"

   # Sequential Multi-Account Support (optional - up to 20 accounts):
   # ALI_USER_2="second_account@email.com"
   # ALI_PASSWORD_2="second_account_password"

   # Local at-rest encryption on disk (session.json.enc) and export (minimum 32 characters)
   # Generate with: openssl rand -base64 32
   SESSION_SECRET="your_secret_key_with_at_least_32_characters"
   ENCRYPT_LOCAL_SESSION=true

   # Smooth cryptographic key rotation (optional):
   # SESSION_SECRET_OLD="old_key_during_rotation"

   # Host identifier in Telegram (optional, useful for servers / Docker containers):
   # NOTIFY_HOST_LABEL="my-vps-server"

   # Dead Man's Switch / Uptime Monitoring (Heartbeat) (optional, e.g.: Healthchecks.io):
   # HEARTBEAT_URL="https://hc-ping.com/your-uuid-here"

   # External destination security (SSRF): webhook and heartbeat block by default
   # loopback/private addresses (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, ::1 etc.).
   # For local tests, explicitly allow private destinations:
   # ALLOW_PRIVATE_WEBHOOKS=true

   # Performance and Browser:
   ALLOW_MEDIA=false
   HEADLESS=true
   LOG_LEVEL=info

   # Disable the Chromium sandbox if necessary (e.g. Ubuntu 24.04 without a custom AppArmor profile):
   # NO_SANDBOX=false
   ```

   Also ensure that any created session files have restricted access:

   ```bash
   chmod 600 session* session_token.txt 2>/dev/null || true
   ```

### Step 8: First Run

Run the unified mode to perform the daily check-in and all tasks in sequence:

```bash
./run_all.sh
# or:
npm start
```

---

## 4. Configuring the Daily Schedule (Crontab)

> **Tip — portable random delay:** instead of randomizing in cron itself
> (`sleep $(shuf ...)`), use `START_DELAY_MIN_MS`/`START_DELAY_MAX_MS` in `credentials.env`
> (e.g. `0` and `3540000` for a start within ~59 min). It works the same on Linux, macOS,
> Windows, and Docker, **does not delay on `--dry-run`**, and can be skipped with `--no-delay`.
> The heartbeat tolerance must be greater than or equal to the delay ceiling.

To ensure your coins are collected daily without manual intervention, configure `cron`.

### The Classic Linux Cron Problem

The `cron` daemon runs tasks with a minimal environment where the `$PATH` variable contains only `/usr/bin:/bin`. If you installed Node via `/usr/local/bin` or NVM, cron will fail silently with the error `node: command not found`.

### How to Configure It Correctly:

1. Open the crontab editor for your user:

   ```bash
   crontab -e
   ```

2. Add the explicit definition of `SHELL` and `PATH` at the top, followed by the scheduler line (example to run every day at 08:00):

   ```cron
   SHELL=/bin/bash
   PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

   0 8 * * * cd /full/path/to/ali-coins && ./run_all.sh >> coins_daily.log 2>&1
   ```

   > Replace `/full/path/to/ali-coins` with the actual directory obtained by running `pwd` inside the project folder.

3. To check the logs of automatic runs at any time:
   ```bash
   tail -n 50 coins_daily.log
   ```

---

## 5. Troubleshooting Common Issues

### A. Error: `E: Unable to locate package libasound2t64`

- **Cause:** This error occurs when trying to install a package exclusive to Ubuntu 24.04 on Ubuntu 22.04 or Debian systems.
- **Solution:** On Ubuntu 22.04 LTS, install `libasound2` (without the `t64` suffix).

### B. Error: `Host system is missing dependencies to run browsers`

- **Cause:** Native C/C++ libraries required by Chromium are missing.
- **How to diagnose exactly which libraries are missing:**
  Run the `ldd` command on the Chromium binary downloaded by Playwright:
  ```bash
  ldd ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | grep "not found"
  ```
- **Solution:** Run `sudo npx playwright install-deps chromium` or install the packages listed in [Step 5](#step-5-installing-chromium-and-native-os-dependencies).

### C. Error: `SyntaxError: Unexpected token '?'` or npm failure

- **Cause:** You are using a legacy version of Node.js (such as the default version 12 on Ubuntu 22.04).
- **Solution:** Follow [Step 2](#step-2-installing-nodejs-22-lts) to install **Node.js 22 LTS**.

### D. Low RAM Servers (512 MB or 1 GB VPS - Native or Docker Execution)

On servers with 1 GB of RAM (such as Oracle Cloud free instances, AWS t2/t3.micro, or DigitalOcean), the Chromium browser or the Node.js process may be terminated by the Linux kernel (_Out of Memory Killer - Exit Code 137_) if memory runs out while loading heavy pages.

The project includes low-consumption optimizations that work **both natively on the host and inside Docker containers**:

1. **Enable 2 GB of Swap Memory on the Host (Essential):**

   ```bash
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

   Validate with `free -h` that the `Swap:` line shows ~2.0Gi.

2. **Chromium Low-Consumption Flags (Enabled by Default):**
   `browser.js` already automatically applies footprint-reduction arguments in any execution (`./run_all.sh`, `npm start`, or Docker):
   - `--disable-gpu` and `--disable-software-rasterizer` (avoids the software rasterization pipeline);
   - `--renderer-process-limit=1` (restricts to 1 renderer process);
   - `--js-flags=--max-old-space-size=128` (limits Chromium's internal V8 heap to 128 MB);
   - `--disk-cache-size=10485760` (limits the cache to 10 MB);
   - Blocking of heavy media (`ALLOW_MEDIA=false`).
     _(If you want to disable it on machines with plenty of memory, set `CHROMIUM_LOW_MEMORY=false`)._

3. **Limit the Node.js Heap Outside Docker (`NODE_OPTIONS`):**
   To force Node.js's Garbage Collector to collect garbage before reaching the server's RAM limit:
   - **In the terminal:**
     ```bash
     export NODE_OPTIONS="--max-old-space-size=256"
     ./run_all.sh
     ```
   - **In Crontab (`crontab -e`):**
     ```cron
     NODE_OPTIONS="--max-old-space-size=256"
     0 8 * * * cd /home/ubuntu/ali-coins && ./run_all.sh >> cron.log 2>&1
     ```

   > The `run_all.sh`/`run.sh`/`run_tasks.sh` scripts already set `NODE_OPTIONS` and `NODE_COMPILE_CACHE` (V8 bytecode cache in `/tmp/ali-coins-compile-cache-$UID`) automatically — the lines above are useful when calling `node` directly.

4. **Reduce the `scrypt` Cryptographic Cost:**
   In `credentials.env`, set:

   ```env
   SCRYPT_N=32768
   ```

   This reduces the instantaneous memory peak of key derivation from ~134 MB to just ~33 MB (or `16384` to ~16 MB), while keeping AES-256-GCM encryption 100% secure.

5. **In Docker Containers:**
   If you run via Docker, the image already includes `NODE_OPTIONS="--max-old-space-size=256"` and `NODE_COMPILE_CACHE=/tmp/node-compile-cache`. When running the container, add the cgroup limits:
   ```bash
   docker run --rm --init --pids-limit=256 \
     --shm-size=256m \
     --memory=768m --memory-swap=1536m \
     -v "$PWD/credentials.env:/app/credentials.env:ro" \
     -v "$PWD/session.json.enc:/app/session.json.enc" \
     ali-coins:latest
   ```
   Declarative alternative: the repository's `docker-compose.yml` already includes the same shm, tmpfs, memory, and security limits (`docker compose up`).

### E. Cloud Servers (Oracle Cloud, AWS, VPS): Captcha Challenge or Login Block

- **Cause:** AliExpress implements strict anti-bot control (Baxia). When a login attempt (username and password) comes from a datacenter/cloud IP (such as Oracle Cloud, AWS, or DigitalOcean), AliExpress almost always blocks the submission by showing a high-precision Slide Captcha or requesting a 2FA confirmation code by email/SMS.
- **How to solve it with encrypted export/import (AES-256-GCM):**
  1. On your local computer (where the residential IP is not blocked):
     ```bash
     export SESSION_SECRET="your_ultra_secret_key_with_more_than_32_characters"
     node export_session.js
     ```
  2. On the cloud server (Oracle Cloud / VPS), inside the `ali-coins` folder, import it securely:
     ```bash
     export SESSION_SECRET="your_ultra_secret_key_with_more_than_32_characters"
     node import_session.js < session_token.txt
     ```
  3. Done! The `session.json` and `session_meta.json` files will be written with restricted `0o600` permissions, and `./run_all.sh` will run daily in the cloud without needing to log in again for weeks or months.

### F. Browser Cache Directory (`PLAYWRIGHT_BROWSERS_PATH`)

- By default, Playwright installs the Chromium binaries in `~/.cache/ms-playwright`.
- In server environments or containers with multiple users / dedicated volumes, you can customize the location by setting:
  ```bash
  export PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
  npx playwright install chromium
  ```
  This allows reusing the browser download across different instances or containers without downloading it again.

### G. Ubuntu 23.10 and Ubuntu 24.04 LTS: Chromium Sandbox Blocked via AppArmor (Restricted User Namespaces)

#### What It Is and Why It Happens

Starting with **Ubuntu 23.10** and consolidated as the default security policy in **Ubuntu 24.04 LTS (Noble Numbat)**, the Ubuntu kernel blocks the creation of _unprivileged user namespaces_ (`CLONE_NEWUSER`) by default for applications that do not have an explicit AppArmor profile (`kernel.apparmor_restrict_unprivileged_userns = 1`).

The Chromium browser (used by Playwright) requires the ability to create user namespaces to initialize its process isolation mechanism (_layered security sandbox_ / Layer-1 Sandbox).

Because Playwright downloads the Chromium binary into the user's home directory (`~/.cache/ms-playwright/chromium-.../chrome-linux/chrome`) instead of installing it as a `.deb` package registered in the system, the kernel intercepts and denies the system call with an `EPERM` error (`apparmor="DENIED" operation="userns_create"`).

**Typical Symptoms and Error Messages:**

```text
[FATAL:zygote_host_impl_linux.cc(117)] No usable sandbox! Update your kernel or see https://chromium.googlesource.com/chromium/src/+/main/docs/linux/sandboxing.md for more information.
```

or

```text
browserType.launch: Failed to launch the browser process!
```

---

#### Available Solutions

There are **3 possible solutions**. Choose the one that best fits your environment:

---

#### Solution 1: Create an AppArmor Profile for Playwright (Recommended / Keeps Security Active)

This is the solution recommended by Canonical and the Playwright team, as it **keeps the system protection active** and specifically authorizes the Chromium binaries managed by Playwright to use user namespaces.

1. Create the profile file `/etc/apparmor.d/playwright-chrome`:

   ```bash
   sudo tee /etc/apparmor.d/playwright-chrome << 'EOF'
   # AppArmor profile for Playwright's Chromium (Ubuntu 23.10 / 24.04 LTS)
   abi <abi/4.0>,
   include <tunables/global>

   profile playwright-chrome /**/.cache/ms-playwright/**/chrome flags=(unconfined) {
     userns,

     include if exists <local/playwright-chrome>
   }
   EOF
   ```

2. Load the new profile into AppArmor:

   ```bash
   sudo apparmor_parser -r /etc/apparmor.d/playwright-chrome
   ```

   _(or alternatively reload the service: `sudo systemctl reload apparmor`)_

3. Done! Chromium will now start normally with the full sandbox enabled, without needing `--no-sandbox`.

---

#### Solution 2: Disable the Kernel User Namespace Restriction via sysctl (Global Host Adjustment)

If your remote host is a dedicated server or a VPS under your control and you prefer to restore the default behavior of earlier Ubuntu versions (22.04 LTS, Debian 11/12, etc.):

- **Temporary (immediate, lasts until the next reboot):**

  ```bash
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
  ```

- **Permanent (persists after restarting the server):**
  ```bash
  echo "kernel.apparmor_restrict_unprivileged_userns = 0" | sudo tee /etc/sysctl.d/60-apparmor-namespace.conf
  sudo sysctl --system
  ```

---

#### Solution 3: Disable the Chromium Sandbox in the Application (`NO_SANDBOX=true`)

If you are in an environment where you **do not have `sudo` privileges** to change `/etc/apparmor.d` or kernel parameters via `sysctl` (for example, shared hosting, restricted containers, or managed corporate instances):

1. Add the variable to your `credentials.env`:
   ```env
   NO_SANDBOX=true
   ```
   Or run it directly in the terminal / crontab:
   ```bash
   NO_SANDBOX=true ./run_all.sh
   ```

> [!WARNING]
> **Security Warning:** The `NO_SANDBOX=true` option instructs Playwright to pass the `--no-sandbox` and `--disable-setuid-sandbox` flags to Chromium, disabling the browser's process isolation sandbox. Since this project strictly accesses the official AliExpress pages for coin collection and daily tasks, the practical risk is minimal on dedicated servers. However, in multi-user environments, prioritizing **Solution 1** is recommended.
