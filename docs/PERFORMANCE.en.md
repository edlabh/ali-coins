# Performance and Memory

Document for Front 6 (2.5.0). Numbers measured on 2026-10-30, Node `v22.23.3`, Linux x64.
They are a development-host baseline — rerun `npm run bench` on the production host before
drawing conclusions. Canonical version: [PERFORMANCE.md](PERFORMANCE.md) (PT-BR).

## 1. How to reproduce

```bash
npm run bench        # readable table
npm run bench -- --json
```

The benchmark measures separate processes (cold start), so it does not reuse the `require
cache` between modules, and uses only a synthetic payload — it never reads
`credentials.env` or real sessions.

## 2. Boot and memory

### Before the optimization

`libs/report.js` imported `libs/ui/balance.js`, which imports Playwright. The same happened
with `libs/runner/multi.js` via `libs/ui`. Result: `all.js --help` and `--dry-run` paid the
browser cost without opening a browser.

| Command                  |  Median | Peak RSS |
| ------------------------ | ------: | -------: |
| `node all.js --help`     | ~260 ms |  ~149 MB |
| `node collect.js --help` | ~260 ms |  ~149 MB |
| `require('./all')`       | ~173 ms |  ~146 MB |

### After the optimization

- `libs/checkin/coins.js`: coin/streak mapping without Playwright; `report.js` no longer
  depends on `ui/balance`.
- `libs/checkin/login-signals.js`: gate/prompt detection without Playwright.
- `libs/ui/desktop-cache.js`: desktop context cache without loading the whole UI.
- `collect.js` loads `libs/runner/single.js` (and Playwright) only when check-in actually
  runs; `--help`, `--dry-run` and `--check-session` do not pay that cost.
- `libs/checkin/captcha.js`: cooldown wrapper without loading the runner.

| Command                           |  Median | Peak RSS |
| --------------------------------- | ------: | -------: |
| `node all.js --help`              | ~135 ms |   ~80 MB |
| `node collect.js --help`          | ~134 ms |   ~80 MB |
| `require('./all')`                | ~117 ms |   ~78 MB |
| `require('./collect')`            | ~113 ms |   ~78 MB |
| `require('./libs/report')`        | ~127 ms |   ~78 MB |
| `require('./libs/runner/single')` | ~282 ms |  ~146 MB |

Observed gain: **~48% less RSS** and **~48% less boot time** for `--help`/dry-run.
`libs/runner/single.js` still loads Playwright by design — it is the module that actually
runs the browser.

> **Measurement scope:** boot, import memory and scrypt are measured here without Chromium.
> Full login, check-in, tasks and shutdown require a real browser run; the `run_metrics`
> event already records `checkin.durationMs`/`tasks.durationMs` per account. Use a
> controlled VPS run for those four stages and compare with the boot benchmark.

## 3. scrypt cost

Synthetic payload with 20 cookies; single execution:

| Parameters                           | Encrypt | Decrypt | Peak RSS (`/usr/bin/time`) |
| ------------------------------------ | ------: | ------: | -------------------------: |
| `N=131072` (default on a roomy host) | ~188 ms | ~170 ms |                    ~197 MB |
| `N=32768` (host ≤1.5 GB / cgroup)    |  ~50 ms |  ~41 ms |                    ~100 MB |

Decisions:

- **No derived-key cache.** scrypt runs a few times per execution and takes tens to a few
  hundred ms; keeping derived keys in memory longer increases exposure without a relevant
  gain compared to Chromium's cost.
- **No reduction of the security floor.** The default `N=131072` is used when memory is
  available; on hosts/cgroups ≤1.5 GB the code already lowers it to `N=32768`, still above
  the cryptographic floor `N=16384`.
- Explicit `SCRYPT_N` remains respected, with defensive floor and ceiling.

## 4. Mobile/desktop context and SPA

- Check-in preserves the mobile page/context (`keepPage`/`onMobilePageKept`) and tasks
  reuse that handle, avoiding a coin-index SPA reload.
- Desktop context reuse (`DESKTOP_REUSE_CONTEXT=true`) is **off by default**: keeping
  mobile + desktop concurrent raises peak RAM/PIDs on constrained hosts. The ~18 s gain
  per read only pays off when there is headroom.
- The runner closes the cached desktop context at the end of each account so it does not
  retain one account's cookies while the next account runs.

## 5. Memory budget

Practical values for the unified flow (check-in + tasks + headless Chromium shell):

| Container/host limit |             Node heap | Recommendation                                    |
| -------------------- | --------------------: | ------------------------------------------------- |
| 256 MB               | 256 MB (`Dockerfile`) | **do not** run Chromium; dry-run/healthcheck only |
| 768 MB               |                256 MB | unified flow with `DESKTOP_REUSE_CONTEXT` off     |
| 1 GB                 |    384 MB (`run*.sh`) | unified flow; desktop reuse optional              |
| ≥2 GB                |    512 MB (`run*.sh`) | desktop reuse may be enabled                      |

The `Dockerfile` sets `NODE_OPTIONS=--max-old-space-size=256` and installs only
`chrome-headless-shell`; host scripts detect RAM and raise it to 384/512 MB, with explicit
`ALI_HEAP_MB`/`NODE_OPTIONS` taking precedence.

## 6. Guardrails

- `tests/performance_budget.test.js` fails if `all.js`, `collect.js` or `libs/report` load
  Playwright at boot again.
- Run `npm run bench` before/after changes to top-level imports, context configuration or
  encryption parameters.
- Use `run_metrics` (`checkin.durationMs`/`tasks.durationMs`) to track production
  regressions; do not raise timeouts without measuring the cause.
