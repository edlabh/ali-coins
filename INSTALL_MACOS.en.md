# Detailed Installation Guide for macOS (Apple Silicon & Intel)

> 🌐 **Languages:** [Português](INSTALL_MACOS.md) | [English](INSTALL_MACOS.en.md)

> ℹ️ English translation of the canonical Portuguese documentation. If there is any divergence, the Portuguese version prevails.

This manual describes the complete step-by-step process to install, configure, and run the **AliExpress Coin Collector & Task Runner** on **macOS** (macOS 12 Monterey, 13 Ventura, 14 Sonoma, and 15 Sequoia), natively compatible with **Apple Silicon (M1, M2, M3, and M4)** processors and **Intel** Macs.

---

## Table of Contents

1. [Minimum Requirements](#1-minimum-requirements)
2. [Method A: Automatic Installation (`setup_macos.sh`)](#2-method-a-automatic-installation-setup_macossh)
3. [Method B: Manual Step-by-Step Installation](#3-method-b-manual-step-by-step-installation)
   - [Step 1: Installing Node.js 22 LTS](#step-1-installing-nodejs-22-lts)
   - [Step 2: Download or Clone the Project and Permissions](#step-2-download-or-clone-the-project-and-permissions)
   - [Step 3: Install npm Dependencies](#step-3-install-npm-dependencies)
   - [Step 4: Install the Playwright Chromium Browser](#step-4-install-the-playwright-chromium-browser)
   - [Step 5: Chromium Validation Test](#step-5-chromium-validation-test)
   - [Step 6: Configure Credentials](#step-6-configure-credentials)
   - [Step 7: First Run](#step-7-first-run)
4. [Daily Automatic Scheduling on macOS](#4-daily-automatic-scheduling-on-macos)
   - [Option 1: Via Cron (Simplest)](#option-1-via-cron-simplest)
   - [Option 2: Via Launchd (Native and Recommended on macOS)](#option-2-via-launchd-native-and-recommended-on-macos)
5. [Troubleshooting Common Issues on macOS](#5-troubleshooting-common-issues-on-macos)

---

## 1. Minimum Requirements

- **System:** macOS 12 (Monterey) or higher.
- **Processor:** Apple Silicon (M1/M2/M3/M4 - ARM64) or Intel (x86_64).
- **Terminal:** macOS Terminal application or iTerm2.
- **Node.js:** Version 22 LTS or higher (`node >= 22`).

---

## 2. Method A: Automatic Installation (`setup_macos.sh`)

The project includes a script that detects your architecture (Apple Silicon or Intel), installs **Node.js** via Homebrew if necessary, downloads the native Chromium binary, grants execution permissions, and prepares your credentials file with automatic generation and pre-configuration of the `SESSION_SECRET` key (AES-256):

```bash
cd ali-coins
chmod +x setup_macos.sh
./setup_macos.sh
```

After running it, configure your email/password with `nano credentials.env` (the cryptographic key is already pre-configured) and start collecting with `./run_all.sh`.

---

## 3. Method B: Manual Step-by-Step Installation

### Step 1: Installing Node.js 22 LTS

The project requires **Node.js 22 or higher**.

#### Option 1: Via Homebrew (Recommended for macOS)

Homebrew is the community's standard package manager for macOS.

1. If you don't have Homebrew installed yet, install it with:

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

   _(On Apple Silicon, follow the instruction displayed at the end of the installation to add Homebrew to PATH in your `~/.zprofile`)_:

   ```bash
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```

2. Install Node.js:
   ```bash
   brew install node
   ```

#### Option 2: From the Official Website (.pkg Package)

1. Go to: [https://nodejs.org/](https://nodejs.org/).
2. Download the recommended **22 LTS** version (`.pkg` installer for macOS).
3. Open the `.pkg` file and follow the Apple installation wizard steps.

#### Option 3: Via NVM (Node Version Manager)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 22
nvm use 22
```

#### Validate the installation:

Open the **Terminal** and confirm the versions:

```bash
node -v
npm -v
```

_(It should display `v22.x.x` or higher and npm version 10 or higher)._

---

### Step 2: Download or Clone the Project and Permissions

Open the Terminal and clone the repository:

```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
chmod +x *.sh
```

---

### Step 3: Install npm Dependencies

In the project folder, install the dependencies declared in `package.json`:

```bash
npm install
```

---

### Step 4: Install the Playwright Chromium Browser

Playwright automatically identifies your processor architecture and downloads the natively compiled version for **Apple Silicon (arm64)** or **Intel (x64)**:

```bash
npx playwright install chromium
```

> **Note for macOS:** Unlike Linux, Chromium on macOS is fully self-contained and does not require installing external system packages via root/sudo.

---

### Step 5: Chromium Validation Test

Run the quick test to confirm that Chromium opens perfectly in the background:

```bash
node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('Chromium OK on macOS!'); await b.close(); })();"
```

If the message `Chromium OK on macOS!` is displayed, the browser is 100% functional.

---

### Step 6: Configure Credentials

1. Create the `credentials.env` file from the template and restrict permissions:

   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```

2. Open the file in your preferred editor (`nano credentials.env` or `open -e credentials.env`):

   ```env
   # AliExpress credentials (required)
   # Always keep them inside double quotes. Passwords with #, spaces, or ! without quotes
   # are silently truncated. E.g.: ALI_PASSWORD="abc#123!"
   ALI_USER="your_email_or_phone"
   ALI_PASSWORD="your_password"

   # Sequential Multi-Account Support (optional - up to 20 accounts):
   # ALI_USER_2="second_account@email.com"
   # ALI_PASSWORD_2="second_account_password"

   # Local at-rest encryption on disk (session.json.enc) and export (minimum 32 characters)
   # Generate in the terminal with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   SESSION_SECRET="your_secret_key_with_at_least_32_characters"
   ENCRYPT_LOCAL_SESSION=true

   # Host identifier in Telegram (optional, useful for multiple computers):
   # NOTIFY_HOST_LABEL="my-macbook-pro"

   # Dead Man's Switch / Uptime Heartbeat (optional, e.g.: Healthchecks.io):
   # HEARTBEAT_URL="https://hc-ping.com/your-uuid-here"

   # External destination security (SSRF): webhook and heartbeat block by default
   # loopback/private addresses (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, ::1 etc.).
   # For local tests, explicitly allow private destinations:
   # ALLOW_PRIVATE_WEBHOOKS=true

   # Performance and Browser:
   ALLOW_MEDIA=false
   HEADLESS=true
   LOG_LEVEL=info
   ```

   Also ensure restricted permission for all session files:

   ```bash
   chmod 600 session* session_token.txt 2>/dev/null || true
   ```

---

### Step 7: First Run

- **Unified Mode (Recommended - Daily Check-in + Tasks):**
  ```bash
  ./run_all.sh
  # or via npm:
  npm start
  ```
- **Daily Check-in Only:** `./run.sh`
- **Tasks Only:** `./run_tasks.sh`

---

## 4. Daily Automatic Scheduling on macOS

> **Tip — portable random delay:** `cron` and `launchd` do not have their own random delay.
> Use `START_DELAY_MIN_MS`/`START_DELAY_MAX_MS` in `credentials.env` (e.g. `0` and `3540000`
> for up to ~59 min) — valid for macOS, Linux, Windows, and Docker, **does not delay on `--dry-run`**,
> and can be skipped with `--no-delay`. The heartbeat tolerance must be >= the delay ceiling.

### Option 1: Via Cron (Simplest)

1. Open the crontab editor in the Terminal:
   ```bash
   crontab -e
   ```
2. Add the lines below to run every day at 08:00 (adjust the folder path):
   ```cron
   SHELL=/bin/zsh
   PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
   NODE_OPTIONS="--max-old-space-size=256"

   0 8 * * * cd /full/path/to/ali-coins && ./run_all.sh >> coins_daily.log 2>&1
   ```

> ⚠️ **Important on macOS Ventura/Sonoma/Sequoia:** Apple's security system requires file access permission for the cron utility. If execution does not write logs, go to:
> **System Settings > Privacy & Security > Full Disk Access** and enable the **Terminal** application and `/usr/sbin/cron`.

---

### Option 2: Via Launchd (Native and Recommended on macOS)

`launchd` is macOS's native subsystem for scheduling background tasks. It has the great advantage of running pending tasks even if the computer is asleep at the exact trigger time.

1. Create the launch agent definition file:

   ```bash
   mkdir -p ~/Library/LaunchAgents
   nano ~/Library/LaunchAgents/com.alicoins.collector.plist
   ```

2. Paste the content below (replace `/Users/YOUR_USER/ali-coins` with the actual path to the project folder):

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.alicoins.collector</string>
       <key>EnvironmentVariables</key>
       <dict>
           <key>NODE_OPTIONS</key>
           <string>--max-old-space-size=256</string>
           <key>NODE_COMPILE_CACHE</key>
           <string>/tmp/ali-coins-compile-cache</string>
       </dict>
       <key>ProgramArguments</key>
       <array>
           <string>/bin/zsh</string>
           <string>-c</string>
           <string>cd /Users/YOUR_USER/ali-coins && ./run_all.sh >> coins_daily.log 2>&1</string>
       </array>
       <key>StartCalendarInterval</key>
       <dict>
           <key>Hour</key>
           <integer>8</integer>
           <key>Minute</key>
           <integer>0</integer>
       </dict>
       <key>StandardErrorPath</key>
       <string>/Users/YOUR_USER/ali-coins/launchd_err.log</string>
       <key>StandardOutPath</key>
       <string>/Users/YOUR_USER/ali-coins/launchd_out.log</string>
   </dict>
   </plist>
   ```

3. Load the agent into the system:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.alicoins.collector.plist
   ```

---

## 5. Troubleshooting Common Issues on macOS

### A. `zsh: command not found: node` or `npm`

- **Cause:** Homebrew or Node.js was installed, but its bin directory is not in the `zsh` shell's `PATH`.
- **Solution:** Add the appropriate line to your `~/.zshrc`:
  - **Apple Silicon:** `export PATH="/opt/homebrew/bin:$PATH"`
  - **Intel:** `export PATH="/usr/local/bin:$PATH"`
    Then run `source ~/.zshrc`.

### B. `zsh: permission denied: ./run_all.sh`

- **Cause:** The script does not have the execution bit enabled.
- **Solution:** Run `chmod +x *.sh` inside the project folder.

### C. macOS Security Alert (Gatekeeper / Unidentified Developer)

- **Cause:** On some macOS versions, the Chromium binary downloaded by Playwright may request a security confirmation.
- **Solution:** Go to **System Settings > Privacy & Security**, scroll to the "Security" section, and click **Allow Anyway** if there is any warning regarding Chromium.

### D. Resource Optimization and Low Memory Consumption (Macs with Little RAM or VMs)

If you run the automation on macOS virtual machines or Macs whose memory resources are shared with other heavy apps:

1. **Native Chromium Low-Consumption Flags:**
   `browser.js` already enables memory-saving flags by default (`--disable-gpu`, `--disable-software-rasterizer`, `--renderer-process-limit=1`, `--js-flags=--max-old-space-size=128`, `--disk-cache-size=10485760`, and `ALLOW_MEDIA=false`). They work automatically via `./run_all.sh` or `npm start`.

2. **Node.js Heap Limit (`NODE_OPTIONS`):**
   To force Node.js's Garbage Collector to keep the heap compact:

   ```bash
   export NODE_OPTIONS="--max-old-space-size=256"
   ./run_all.sh
   ```

   > The `run_all.sh`/`run.sh`/`run_tasks.sh` scripts already set `NODE_OPTIONS` and `NODE_COMPILE_CACHE` (V8 bytecode cache in `/tmp/ali-coins-compile-cache-$UID`) automatically — the lines above are useful when calling `node` directly.

3. **`scrypt` Cryptographic Cost:**
   In `credentials.env`, set `SCRYPT_N=32768` (or `16384`) to limit the key derivation peak from ~134 MB to ~33 MB while loading the session.

---
