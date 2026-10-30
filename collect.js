const {
  loadConfig,
  handleDryRun,
  isCheckSession,
  isForce,
  checkAndDisplayHelp
} = require('./config');
const { acquireLock, LockActiveError } = require('./lockfile');
const { flushAndExit } = require('./libs/exit');
const { runCheckin, checkCaptchaCooldownForLogin } = require('./libs/runner/single');
const { shouldAttemptLogin } = require('./libs/checkin/login-gate');
const {
  shouldConfirmCheckinByLedger,
  shouldConfirmStreakByStatement,
  shouldReuseEarlyDesktop
} = require('./libs/checkin/streak');
const { isSessionDataMissing } = require('./libs/checkin/result');
const logger = require('./logger');

if (require.main === module) {
  const { setupGlobalCrashHandler } = require('./libs/crash');
  let cfg = null;
  setupGlobalCrashHandler(() => ({ config: cfg, scriptName: 'collect.js' }));

  if (checkAndDisplayHelp()) {
    void flushAndExit(0);
    return;
  }

  let activeBrowser = null;
  let releaseLock = null;
  let gracefulExitRef = null;

  // Encerramento por sinal em modo standalone: fecha o browser antes de liberar o lock,
  // prevenindo processos Chromium órfãos na memória se interrompido via SIGINT/SIGTERM.
  const handleShutdownSignal = (signal) => {
    logger.warn({ signal }, 'Sinal recebido em collect.js; fechando browser e liberando lock...');
    if (typeof gracefulExitRef === 'function') {
      void gracefulExitRef(1);
      return;
    }
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(1);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => handleShutdownSignal(signal));
  }

  (async () => {
    if (await handleDryRun()) {
      await flushAndExit(0);
    }

    if (isCheckSession()) {
      const { runSessionCheckCli } = require('./libs/session-check');
      const code = await runSessionCheckCli({ allAccounts: false });
      await flushAndExit(code);
      return;
    }

    const { sendTelegram } = require('./libs/notify');
    try {
      cfg = loadConfig(true);
    } catch {
      // Ignorar se falhar antes do lock
    }

    gracefulExitRef = async (exitCode = 1) => {
      gracefulExitRef = null;
      if (activeBrowser) {
        await Promise.race([
          activeBrowser.close().catch(() => {}),
          new Promise((resolve) => {
            const timer = setTimeout(resolve, 3000);
            if (timer.unref) timer.unref();
          })
        ]);
        activeBrowser = null;
      }
      if (releaseLock) {
        await releaseLock().catch(() => {});
        releaseLock = null;
      }
      await flushAndExit(exitCode);
    };

    try {
      releaseLock = await acquireLock(isForce());
    } catch (err) {
      gracefulExitRef = null;
      if (err instanceof LockActiveError) {
        await sendTelegram({ config: cfg, event: 'lock_active', error: err }).catch(() => {});
        await flushAndExit(3);
      }
      logger.error({ err: err.message }, 'Falha ao obter lock.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      await flushAndExit(1);
    }

    try {
      const result = await runCheckin({
        onBrowserLaunch: (b) => {
          activeBrowser = b;
        }
      });
      activeBrowser = null;
      gracefulExitRef = null;
      if (releaseLock) await releaseLock();
      const report = { type: 'checkin', ...result };
      // Mesma regra do fluxo unificado: crédito confirmado no extrato de hoje conta como
      // nova ação mesmo com alreadyCollected=true (o bot pode não ter clicado).
      const hadNewCheckin = Boolean(
        result && (!result.alreadyCollected || result.checkinCoinsFromLedger === true)
      );
      const event = hadNewCheckin ? 'success' : 'already_collected';
      await sendTelegram({ config: cfg, report, event }).catch(() => {});
      if (!hadNewCheckin) {
        await flushAndExit(2);
      }
      await flushAndExit(0);
    } catch (err) {
      activeBrowser = null;
      gracefulExitRef = null;
      if (releaseLock) await releaseLock();
      if (err.name === 'TwoFactorRequiredNonInteractive' || err.is2FARequired) {
        logger.error(
          '[2FA Não-Interativo] O AliExpress exigiu verificação de código 2FA durante execução sem terminal interativo (cron/CI). ' +
            'Solução: execute localmente com "./run_all.sh", resolva o 2FA e use "node export_session.js" / "node import_session.js".'
        );
        await sendTelegram({ config: cfg, event: '2fa_required', error: err }).catch(() => {});
        await flushAndExit(5);
      }
      if (err.isImportedSessionExpired) {
        logger.error(
          '[Sessão Remota Expirada] Login falhou em servidor remoto. Sugestão: gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
        );
      }
      logger.error({ err: err.message }, 'Falha no check-in diário.');
      await sendTelegram({
        config: cfg,
        event: err.isManualLoginRequired
          ? 'manual_login_required'
          : err.isRiskControl
            ? 'risk_blocked'
            : 'failure',
        error: err
      }).catch(() => {});
      await flushAndExit(err.isManualLoginRequired ? 7 : 1);
    }
  })().catch(async (err) => {
    // Erros fora do try principal (ex: loadConfig inválido em --dry-run) não devem
    // escalar para o crash handler (exit 6); são falha crítica de execução (exit 1).
    logger.error({ err: err.message }, 'Falha inesperada na execução do check-in.');
    await flushAndExit(1);
  });
}

module.exports = {
  runCheckin,
  isSessionDataMissing,
  shouldConfirmCheckinByLedger,
  shouldConfirmStreakByStatement,
  shouldReuseEarlyDesktop,
  shouldAttemptLogin,
  checkCaptchaCooldownForLogin
};
