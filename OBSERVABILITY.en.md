# Observability, SLOs and Playbook

Operational document for the `ali-coins` automation. It complements the existing reports
(`renderUnifiedReport` / `renderMultiAccountReport`) with per-run metrics and reliability
targets. Canonical version: [OBSERVABILITY.md](OBSERVABILITY.md) (PT-BR); if they diverge,
the Portuguese version prevails.

## 1. Questions on-call must answer

1. Did the daily run execute and finish without a critical error?
2. If it failed, was it expired session, captcha/risk, 2FA, lock or code error?
3. How long did check-in and tasks take?
4. Did the streak really drop, or was it a read failure?
5. How many coins were credited, and to which accounts?

Every signal below exists to answer one of these questions. Telemetry without a question
is noise.

## 2. `run_metrics` event

At the end of every run (including failures), the runner emits a structured event:

```json
{
  "event": "run_metrics",
  "schemaVersion": 1,
  "runId": "6f2d7a3e-1a7c-4f45-9f4a-1b2c3d4e5f60",
  "mode": "multi",
  "startedAt": "2026-10-30T09:30:00.000Z",
  "endedAt": "2026-10-30T09:34:12.000Z",
  "durationMs": 252000,
  "exitCode": 0,
  "accounts": [
    {
      "account": "us***@example.com",
      "index": 1,
      "checkin": {
        "outcome": "success",
        "durationMs": 120000,
        "streakBefore": 253,
        "streakAfter": 254,
        "longestStreak": 260,
        "coins": 40,
        "alreadyCollected": false,
        "reusedContext": false,
        "loginAttempted": false,
        "captcha": false,
        "errorClass": null
      },
      "tasks": {
        "outcome": "success",
        "durationMs": 90000,
        "coinsGained": 25,
        "tasksCount": 8,
        "errorClass": null
      },
      "streakBroken": false
    }
  ],
  "totals": {
    "accounts": 1,
    "checkin": { "success": 1, "already": 0, "blocked": 0, "error": 0, "skipped": 0 },
    "tasks": { "success": 1, "error": 0, "skipped": 0 },
    "streakBroken": 0,
    "coinsGained": 65
  }
}
```

It is accompanied by a readable line:

```
Metrics run=6f2d... mode=multi duration=4m12s accounts=1 check-in=success:1 tasks=success:1 streak-broken=0 coins=65 exit=0
```

Privacy rules:

- `account` is always masked (`maskUser`);
- the event uses an allowlist and **never** includes cookies, `storageState`, tokens, full
  e-mails or raw error messages;
- `errorClass` is a closed set (`captcha`, `captcha_cooldown`, `risk_control`,
  `manual_login`, `2fa`, `session_expired`, `lock_active`, `unknown`).

Relevant exit codes: `0` success, `2` already collected with no new action, `3` active
lock, `4` broken streak, `5` non-interactive 2FA, `6` crash, `7` manual intervention.

## 3. SLIs and SLOs

| SLI                       | Definition                                                                        | SLO          | Window     |
| ------------------------- | --------------------------------------------------------------------------------- | ------------ | ---------- |
| Daily run completed       | `exitCode` in `{0,2,4}` / scheduled runs                                          | **≥ 99%**    | 30 days    |
| Check-in on time          | `accounts[].checkin.durationMs ≤ 600000` / check-ins                              | **≥ 95%**    | 30 days    |
| Streak regression by read | runs with an unexplained drop (`streakBroken=true` and untrusted read)            | **0**        | always     |
| Session valid on check    | `session_check.ok=true` / checks                                                  | **≥ 99%**    | 30 days    |
| Persistent captcha        | consecutive days with `errorClass` in `{captcha, captcha_cooldown, risk_control}` | **≤ 2 days** | continuous |

Latency targets are an operational guardrail, not a product promise. Adjust the 10-minute
limit with real VPS data before creating a page-worthy alert.

### Error budget

- 99% SLO over 30 days ⇒ **1%** budget (≈ 7.2 h of equivalent downtime).
- 50% consumed: prioritize reliability fixes over new features.
- 100% consumed: freeze non-critical changes until the budget is restored.

## 4. Recommended alerts

Alerts must be symptom-based (user/business impact), not cause-based. Every alert needs a
link to this playbook.

| Alert               | Condition                                                    | Severity    | First action                                       |
| ------------------- | ------------------------------------------------------------ | ----------- | -------------------------------------------------- |
| `CronRunMissed`     | no `run_metrics`/heartbeat event in 26 h                     | page        | check cron, container and locks                    |
| `DailyRunFailed`    | 2 consecutive runs with `exitCode` in `{1,5,6,7}`            | page        | open session/captcha playbook                      |
| `SessionExpired`    | `session.check.invalid` or `exitCode=7`                      | ticket/page | renew/import session                               |
| `StreakBroken`      | `exitCode=4` or `accounts[].streakBroken=true`               | ticket      | confirm read and statement before notifying        |
| `CheckinSlow`       | `checkin.durationMs > 600000` in 2 runs                      | ticket      | measure VPS/network, do not blindly raise timeouts |
| `CaptchaPersistent` | 3 consecutive days with `errorClass=captcha*`/`risk_control` | page        | manual login + import; review IP                   |

Useful queries (JSON logs):

```bash
# latest metrics
jq -c 'select(.event=="run_metrics")' ali-coins.log | tail -5

# failures by class
jq -r 'select(.event=="run_metrics") | .accounts[] | .checkin.errorClass // empty' ali-coins.log |
  sort | uniq -c

# check-in duration per account
jq -r 'select(.event=="run_metrics") | .accounts[] | "\(.account) \(.checkin.durationMs)"' ali-coins.log
```

## 5. Incident playbooks

### 5.1 Cron did not run (`CronRunMissed`)

1. Confirm the dead man's switch heartbeat and the cron time (`09:30 UTC`).
2. Check `systemctl status cron`, host logs and disk space.
3. Look for an orphan lock: `ali-coins*.lock`; confirm the PID still exists **before**
   removing it.
4. Run `./run_all.sh --no-delay` (or `npm start`) manually and watch `run_metrics`.
5. If the host is out of memory, check `dmesg`/OOM and reduce concurrency.

### 5.2 Expired session (`SessionExpired`)

1. Run `node all.js --check-session --json` and confirm `ok=false` plus the reason.
2. If the cookie is expired, create a new session on the local host with
   `node export_session.js` and import it with `node import_session.js`.
3. Never paste cookies/tokens into an issue, chat or log. Use only local files.
4. Revalidate with `--check-session` before re-enabling cron.

### 5.3 Broken streak (`StreakBroken`)

1. **Do not** assume a real break: check `trustDetected`, `statementStreakDays` and the
   day's desktop statement.
2. Compare `previousStreakDays` and `streakDays` in the report/`session_meta.json`.
3. If the dynamic read is suspicious, wait for the next run and validate the mobile
   calendar before communicating a loss.
4. If the break is real, record the date and value for manual reconciliation.

### 5.4 Persistent captcha/risk (`CaptchaPersistent`)

1. Check `errorClass` and `cooldownUntil` in the account's `session_meta.json`.
2. Stop automatic attempts: insisting escalates the risk.
3. Perform a manual login in a visible window on the local host, solve the challenge and
   import the session.
4. If the IP is flagged, consider changing the egress network before resuming.
5. Only clear the cooldown with `--force` after human confirmation.

### 5.5 Slow check-in (`CheckinSlow`)

1. Compare `checkin.durationMs` with the baseline and check VPS CPU/RAM.
2. Check whether the desktop context is being reused (`reusedContext`).
3. Do not increase timeouts without identifying whether the bottleneck is network,
   selector or memory.
4. Record the before/after measurement for any change.

## 6. Verifying the telemetry

- Run a controlled execution and find the `run_metrics` event by `runId`.
- Confirm `account` is masked and there are no cookies/tokens in the JSON.
- Force a session failure and validate `errorClass=session_expired` and `exitCode=7`.
- Force a read failure and validate `streakBroken=true` only with a trusted read.
- Confirm the alert points to this document and to the diagnostic command.
