# Detailed Installation Guide for Windows (Windows 10 and Windows 11)

> 🌐 **Languages:** [Português](INSTALL_WINDOWS.md) | [English](INSTALL_WINDOWS.en.md)

> ℹ️ English translation of the canonical Portuguese documentation. If there is any divergence, the Portuguese version prevails.

This manual describes the complete step-by-step process to install, configure, and run the **AliExpress Coin Collector & Task Runner** on **Windows 10** and **Windows 11** (64-bit), via Command Prompt (CMD) or PowerShell.

> [!NOTE]
> **What's new in 2.5.0:** installation is unchanged (Node.js 22 + Playwright). The release
> adds `run_metrics` with `runId`, stable i18n IDs, ~48% lighter boot on `--help`/dry-run,
> `--check-session` warnings for `expiresAt`, PowerShell validation in CI and the
> `npm run bench` benchmark. See [README.en.md](README.en.md),
> [OBSERVABILITY.en.md](OBSERVABILITY.en.md) and [PERFORMANCE.en.md](PERFORMANCE.en.md).

---

## Table of Contents

1. [Minimum Requirements](#1-minimum-requirements)
2. [Method A: Automatic Installation](#2-method-a-automatic-installation)
3. [Method B: Manual Step-by-Step Installation](#3-method-b-manual-step-by-step-installation)
   - [Step 1: Installing Node.js 22 LTS](#step-1-installing-nodejs-22-lts)
   - [Step 2: Download or Clone the Project](#step-2-download-or-clone-the-project)
   - [Step 3: Allow Script Execution in PowerShell (If Applicable)](#step-3-allow-script-execution-in-powershell-if-applicable)
   - [Step 4: Install npm Dependencies](#step-4-install-npm-dependencies)
   - [Step 5: Install the Playwright Chromium Browser](#step-5-install-the-playwright-chromium-browser)
   - [Step 6: Chromium Validation Test](#step-6-chromium-validation-test)
   - [Step 7: Configure Credentials and Encryption](#step-7-configure-credentials-and-encryption)
   - [Step 8: First Run](#step-8-first-run)
4. [Authenticated Session Export and Import](#4-authenticated-session-export-and-import)
5. [Daily Automatic Scheduling (Task Scheduler)](#5-daily-automatic-scheduling-task-scheduler)
   - [Option 1: Automatic Creation via PowerShell (1 Command)](#option-1-automatic-creation-via-powershell-1-command)
   - [Option 2: Manual Creation via Graphical Interface](#option-2-manual-creation-via-graphical-interface)
6. [Troubleshooting Common Issues on Windows](#6-troubleshooting-common-issues-on-windows)

---

## 1. Minimum Requirements

- **Operating System:** Windows 10 (version 1809 or later) or Windows 11 (64-bit).
- **Terminal:** Command Prompt (`cmd.exe`), PowerShell (`powershell.exe`), or Windows Terminal.
- **Node.js:** Version 22 LTS or higher (`node >= 22`).
- **Privileges:** Standard user (administrator required only to install global packages or change execution policies).

---

## 2. Method A: Automatic Installation

The project includes automated installers that check the Node.js version, run `npm install`, install the Chromium binary, generate the `credentials.env` template, and validate the browser's headless operation.

### Option 1: Via Command Prompt or Double-Click (CMD)

1. Open the project folder in **File Explorer**.
2. Double-click the **`scripts/setup_windows.bat`** file (or run `scripts\setup_windows.bat` in CMD).
3. Wait for it to finish with the message `INSTALACAO CONCLUIDA COM SUCESSO!`.

### Option 2: Via PowerShell

Open the PowerShell terminal in the project folder and run:

```powershell
.\scripts\setup_windows.ps1
```

> If PowerShell displays a script execution disabled error, run this first:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

At the end, configure your credentials in `credentials.env` and run `run_all.bat` (or `.\run_all.ps1`).

---

## 3. Method B: Manual Step-by-Step Installation

### Step 1: Installing Node.js 22 LTS

The project requires **Node.js 22 or higher**.

#### Option 1: Via the Windows Package Manager (`winget`)

```cmd
winget install OpenJS.NodeJS.LTS
```

#### Option 2: Via Chocolatey

```cmd
choco install nodejs-lts
```

#### Option 3: From the Official Website (.msi Installer)

1. Go to: [https://nodejs.org/](https://nodejs.org/).
2. Download the recommended **22 LTS** version (`.msi` installer for Windows x64).
3. Run the installer keeping the default options (make sure **"Add to PATH"** is selected).
4. Close and reopen the terminal to reload `PATH`.

#### Validate the installation:

```cmd
node -v
npm -v
```

_(The `node -v` command should display `v22.x.x` or higher, and `npm -v` should display version 10 or higher)._

---

### Step 2: Download or Clone the Project

#### Via Git:

```cmd
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
```

#### Or via ZIP Download:

1. On GitHub, click **Code** > **Download ZIP**.
2. Extract the ZIP file into a folder (example: `C:\Users\YourUser\ali-coins`).
3. Open the terminal in that folder.

---

### Step 3: Allow Script Execution in PowerShell (If Applicable)

If you will use PowerShell and receive a scripts disabled warning:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

### Step 4: Install npm Dependencies

In the project folder root:

```cmd
npm install
```

This installs the required dependencies (`playwright`, `zod`, `pino`, `commander`, etc.).

---

### Step 5: Install the Playwright Chromium Browser

Playwright manages the browser in isolation in `%USERPROFILE%\AppData\Local\ms-playwright`.

Run:

```cmd
npx playwright install chromium
```

> On clean Windows installations or virtual machines without C++ runtime packages, you may need to install the Microsoft Visual C++ Redistributable:
>
> ```cmd
> winget install Microsoft.VCRedist.2015+.x64
> ```

---

### Step 6: Chromium Validation Test

To confirm that Chromium starts in headless mode:

- **In Command Prompt (CMD):**

  ```cmd
  node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(b => b.close()).then(() => console.log('Chromium OK!')).catch(e => { console.error(e); process.exit(1); })"
  ```

- **In PowerShell:**
  ```powershell
  node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(b => b.close()).then(() => console.log('Chromium OK!')).catch(e => { console.error(e); process.exit(1); })"
  ```

If the output displays `Chromium OK!`, your environment is ready.

---

### Step 7: Configure Credentials and Encryption

1. Create the `credentials.env` file from the example template:
   - **In CMD:**
     ```cmd
     copy credentials.env.example credentials.env
     ```
   - **In PowerShell:**
     ```powershell
     Copy-Item credentials.env.example credentials.env
     ```

2. Open the file in Notepad:

   ```cmd
   notepad credentials.env
   ```

3. Fill in the main settings:

   ```env
   # AliExpress credentials
   # Always keep them inside double quotes. Passwords with #, spaces, or ! without quotes
   # are silently truncated. E.g.: ALI_PASSWORD="abc#123!"
   ALI_USER="your_email_or_phone"
   ALI_PASSWORD="your_password"

   # Sequential Multi-Account Support (optional - up to 20 accounts):
   # ALI_USER_2="second_account@email.com"
   # ALI_PASSWORD_2="second_account_password"

   # AES-256-GCM encryption key for at-rest and export (minimum 32 characters)
   # How to generate it using Node.js on Windows: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   SESSION_SECRET="your_secret_key_with_at_least_32_characters"

   # Local at-rest session encryption on disk (session.json.enc)
   ENCRYPT_LOCAL_SESSION=true

   # Computer identifier in Telegram messages (optional)
   # NOTIFY_HOST_LABEL="my-windows-desktop"

   # Dead Man's Switch / Uptime Heartbeat (optional, e.g.: Healthchecks.io)
   # HEARTBEAT_URL="https://hc-ping.com/your-uuid"

   # External destination security (SSRF): webhook and heartbeat block by default
   # loopback/private addresses (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, ::1 etc.)
   # For local tests, explicitly allow private destinations:
   # ALLOW_PRIVATE_WEBHOOKS=true
   ```

   _Save the file (`Ctrl + S`) and close Notepad._

#### How to generate the 32-character key (`SESSION_SECRET`):

You can obtain your cryptographic key using any of the following methods:

- **Option 1 (Recommended on Windows - Native Node.js, no OpenSSL):**
  Since Node.js is already installed on your system, run directly in CMD or PowerShell:
  ```cmd
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  This instantly generates a cryptographically secure random 32-byte key in Base64 (44 characters) ready to paste into `credentials.env`.
- **Option 2 (Via the 1-Click Script):**
  Run the key generator utility included in `scripts/`:
  - In Command Prompt (CMD): `scripts\generate_secret.bat`
  - In PowerShell: `.\scripts\generate_secret.ps1`
- **Option 3 (Via OpenSSL - if installed on the system or in Git for Windows):**
  If you already have OpenSSL installed on the system or Git for Windows, run in the terminal:
  ```cmd
  openssl rand -base64 32
  ```
- **Option 4 (Automatic Generation by the Installer):**
  If you used the `scripts/setup_windows.bat` or `scripts/setup_windows.ps1` installer (Method A), the 32-character `SESSION_SECRET` key has already been generated and configured automatically in your `credentials.env` file.

---

### Step 8: First Run

- **Unified Mode (Recommended - Daily Check-in + Tasks):**
  - In CMD: `run_all.bat`
  - In PowerShell: `.\run_all.ps1`
  - Via npm: `npm start`

- **Check-in Only:**
  - In CMD: `run.bat`
  - In PowerShell: `.\run.ps1`

- **Tasks Only:**
  - In CMD: `run_tasks.bat`
  - In PowerShell: `.\run_tasks.ps1`

---

## 4. Authenticated Session Export and Import

If your AliExpress login encounters a Slide Captcha or you want to transfer the session between computers without exposing credentials:

### Export the encrypted session (AES-256-GCM v2):

- **Single or default account:**
  ```cmd
  node export_session.js
  ```
- **Export all accounts (multi-account):**
  ```cmd
  node export_session.js --all
  ```
- **Export only a specific account:**
  ```cmd
  node export_session.js --account=2
  ```

The encrypted tokens will be written to `session_token.txt` (Account 1), `session_token_2.txt` (Account 2), etc.

### Import the encrypted session:

- **Import all accounts at once:**
  ```cmd
  node import_session.js --all
  ```
- **Import an individual account (Command Prompt - CMD):**
  ```cmd
  node import_session.js --from-file=session_token.txt
  node import_session.js --from-file=session_token_2.txt
  ```
- **Import an individual account (PowerShell):**
  ```powershell
  Get-Content session_token.txt | node import_session.js
  Get-Content session_token_2.txt | node import_session.js
  ```

> The importer performs **smart auto-routing**: it identifies which account the token belongs to and saves it into the corresponding isolated files (`session.json.enc` for Account 1, `session_<hash>.json.enc` for the others), never overwriting other accounts.

---

## 5. Daily Automatic Scheduling (Task Scheduler)

> **Tip — portable random delay:** the Windows Scheduler has its own delay, but it
> is not portable. With `START_DELAY_MIN_MS`/`START_DELAY_MAX_MS` in `credentials.env`
> (e.g. `0` and `3540000` for up to ~59 min) the behavior is the same on any system,
> **does not delay on `--dry-run`**, and can be skipped with `--no-delay`. On Windows, remember
> that the task's "time limit" counts the delay; the heartbeat tolerance must be >= the ceiling.

### Option 1: Automatic Creation via PowerShell (1 Command)

Open PowerShell in the project folder and run (example to run daily at **08:00**):

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c set "NODE_OPTIONS=--max-old-space-size=256" && set "NODE_COMPILE_CACHE=%TEMP%\ali-coins-compile-cache" && run_all.bat >> coins_daily.log 2>&1' -WorkingDirectory "$PWD"
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
Register-ScheduledTask -TaskName "AliExpressCoinsCollector" -Action $action -Trigger $trigger -Description "AliExpress daily coin collection"
```

---

### Option 2: Manual Creation via Graphical Interface

1. Press `Win + R`, type `taskschd.msc`, and click **OK**.
2. In the right-hand menu, click **Create Basic Task...**.
3. **Name:** Type `AliExpress Coins Collector` and click **Next**.
4. **Trigger:** Select **Daily** and set the desired execution time (e.g. `08:00:00`).
5. **Action:** Select **Start a program**.
6. **Action Configuration:**
   - **Program/script:** `cmd.exe`
   - **Add arguments (optional):** `/c run_all.bat >> coins_daily.log 2>&1`
   - **Start in (optional):** Full path to the project folder (example: `C:\Users\YourUser\ali-coins`).
7. Click **Next** and then **Finish**.

---

## 6. Troubleshooting Common Issues on Windows

### A. `'node' or 'npm' is not recognized as an internal or external command`

- **Cause:** Node.js was not added to the `PATH` environment variable, or the terminal was opened before the installation finished.
- **Solution:** Close all terminal windows and open a new one. If it persists, restart the computer.

### B. `Error initializing Chromium: MSVCP140.dll / VCRUNTIME140.dll missing`

- **Cause:** Windows environments without the Microsoft Visual C++ Redistributable installed cannot load the Chromium headless compilation dependencies.
- **Solution:** Run in the terminal:
  ```cmd
  winget install Microsoft.VCRedist.2015+.x64
  ```

### C. `The file ... cannot be loaded because running scripts is disabled on this system`

- **Cause:** PowerShell's default restriction policy (`ExecutionPolicy Restricted`).
- **Solution:** Run in PowerShell:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

### D. Running `scripts/setup_windows.bat` as Administrator changes the working directory

- **Cause:** By default, Windows sets `C:\Windows\System32` as the working directory when choosing "Run as Administrator".
- **Solution:** `scripts/setup_windows.bat` already includes the anchoring command `cd /d "%~dp0.."` to ensure dependencies are always installed in the correct project folder.

### E. Windows Defender / SmartScreen Alert

- **Cause:** Since Playwright opens a background browser process with event control, strict antivirus software may display an alert on the first run.
- **Solution:** Click **"More info"** and then **"Run anyway"**.

### F. Long Path Error (`Filename too long` / MAX_PATH)

- **Cause:** Windows limits file paths to 260 characters by default.
- **Solution:** Enable long paths in PowerShell (as Administrator):
  ```powershell
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
  ```

### G. Strange Characters or Broken Emojis in Logs (Mojibake / Encoding)

- **Cause:** By default, classic Windows terminals (CMD and PowerShell 5.1) use legacy code pages (CP850 or CP437), which do not natively render UTF-8 strings or emojis such as `🪙`, `💰`, `⏱️`, `✅`, `🚨`.
- **Solution:**
  - Use the provided scripts (`run_all.bat` or `.\run_all.ps1`), which automatically configure the UTF-8 code page (`chcp 65001`) and console encodings.
  - If you prefer to run `node` commands manually in an open terminal, run this first:
    - In Command Prompt (CMD): `chcp 65001`
    - In PowerShell: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 > $null`
  - We also recommend using **Windows Terminal** (native on Windows 11 or installable via `winget install Microsoft.WindowsTerminal`), which has modern support and full emoji rendering by default.
- **Log file with broken accents:** in **PowerShell 5.1**, redirecting with `>`/`>>`
  writes the file in **UTF-16LE** (it looks "broken" in tools that expect UTF-8). Prefer:
  - **CMD (recommended, produces UTF-8):** `run_all.bat >> coins_daily.log 2>&1`
  - **PowerShell (forces UTF-8):** `.\run_all.ps1 2>&1 | Out-File -FilePath coins_daily.log -Append -Encoding utf8`
  - To **view** the log, use Notepad or VS Code (they detect UTF-8). In CMD, `type coins_daily.log` may display incorrectly if the code page is not 65001.

### H. Optimization for Low RAM Environments (1 GB to 2 GB or Windows VMs)

If you run the automation on compact Windows virtual machines or computers with little available memory:

1. **Virtual Memory (Pagefile):**
   - Make sure Windows has a page file enabled and managed by the system (or fixed at at least 2 GB).
   - Check in: **Settings > System > About > Advanced system settings > Advanced > Performance (Settings) > Advanced > Virtual memory**.

2. **Native Chromium Low-Consumption Flags:**
   - `libs/core/browser.js` already applies the `--disable-gpu`, `--disable-software-rasterizer`, `--renderer-process-limit=1`, `--js-flags=--max-old-space-size=128`, `--disk-cache-size=10485760` arguments and `ALLOW_MEDIA=false` by default in runs via `run_all.bat` and `run_all.ps1`.

3. **Node.js Heap Limit (`NODE_OPTIONS`):**
   - To force Node.js's Garbage Collector to keep consumption compact (256 MB):
     - In Command Prompt (CMD):
       ```cmd
       set "NODE_OPTIONS=--max-old-space-size=256" && set "NODE_COMPILE_CACHE=%TEMP%\ali-coins-compile-cache" && run_all.bat
       ```
     - In PowerShell:
       ```powershell
       $env:NODE_OPTIONS = "--max-old-space-size=256"
       $env:NODE_COMPILE_CACHE = Join-Path $env:TEMP "ali-coins-compile-cache"
       .\run_all.ps1
       ```

   > The `run_all.bat`/`run.ps1`/`run_tasks.*` scripts already set `NODE_OPTIONS` and `NODE_COMPILE_CACHE` (V8 bytecode cache in `%TEMP%`) automatically.

4. **Reduce the `scrypt` Cryptographic Cost:**
   - In `credentials.env`, set `SCRYPT_N=32768` (or `16384`) to limit the key derivation peak from ~134 MB to ~33 MB while reading/writing the `.enc` session.
