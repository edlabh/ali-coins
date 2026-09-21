const { z } = require('zod');
const { formatDate, formatTime, formatDuration } = require('../time_utils');
const { maskUser } = require('../config');
const { getCheckinCoinsFromStreak } = require('./ui/balance');
const { validateExternalUrl, safeFetch } = require('./url_guard');
const logger = require('../logger');

// Teto de payload enviado a webhooks externos (32 KB): protege memória e destinos.
const WEBHOOK_MAX_PAYLOAD_BYTES = 32 * 1024;

/**
 * Esquema Zod de validação do contrato JSON do relatório unificado
 */
const unifiedReportSchema = z.object({
  type: z.literal('unified_report'),
  user: z.string().optional(),
  checkin: z
    .object({
      alreadyCollected: z.boolean(),
      coinsGainedToday: z.string(),
      streakDays: z.union([z.number(), z.string()]),
      previousStreakDays: z.union([z.number(), z.string()]).optional().nullable(),
      totalBalance: z.string(),
      duration: z.string()
    })
    .nullable(),
  tasks: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string(),
            status: z.string(),
            coins: z.string().optional(),
            estimatedCoins: z.string().optional()
          })
        )
        .optional(),
      initialBalance: z.union([z.number(), z.string()]).optional(),
      finalBalance: z.union([z.number(), z.string()]).optional(),
      coinsGained: z.union([z.number(), z.string()]).optional(),
      finalCoins: z.string(),
      duration: z.string()
    })
    .nullable(),
  meta: z.object({
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    totalDuration: z.string().optional(),
    step1Duration: z.string().optional(),
    step2Duration: z.string().optional(),
    finalBalance: z.string(),
    totalCoinsGained: z.union([z.number(), z.string()]).optional(),
    checkinCoinsGained: z.union([z.number(), z.string()]).optional(),
    tasksCoinsGained: z.union([z.number(), z.string()]).optional(),
    tasksError: z.string().optional()
  })
});

/**
 * Esquema Zod de validação do contrato JSON do relatório multi-conta
 */
const multiAccountReportSchema = z.object({
  type: z.literal('multi_account_report'),
  accounts: z.array(
    z.object({
      user: z.string(),
      checkin: z
        .object({
          alreadyCollected: z.boolean(),
          coinsGainedToday: z.string(),
          streakDays: z.union([z.number(), z.string()]),
          previousStreakDays: z.union([z.number(), z.string()]).optional().nullable(),
          totalBalance: z.string(),
          duration: z.string()
        })
        .nullable(),
      tasks: z
        .object({
          results: z
            .array(
              z.object({
                title: z.string(),
                status: z.string(),
                coins: z.string().optional(),
                estimatedCoins: z.string().optional()
              })
            )
            .optional(),
          initialBalance: z.union([z.number(), z.string()]).optional(),
          finalBalance: z.union([z.number(), z.string()]).optional(),
          coinsGained: z.union([z.number(), z.string()]).optional(),
          finalCoins: z.string(),
          duration: z.string()
        })
        .nullable(),
      error: z.string().optional(),
      tasksError: z.string().optional(),
      isImportedSessionExpired: z.boolean().optional(),
      duration: z.string().optional(),
      meta: z.object({
        finalBalance: z.string(),
        totalCoinsGained: z.union([z.number(), z.string()]).optional(),
        checkinCoinsGained: z.union([z.number(), z.string()]).optional(),
        tasksCoinsGained: z.union([z.number(), z.string()]).optional(),
        tasksError: z.string().optional()
      })
    })
  ),
  meta: z.object({
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    totalDuration: z.string().optional(),
    totalAccounts: z.number(),
    successfulAccounts: z.number()
  })
});

/**
 * Determina se houve quebra de sequência (streak break)
 * Regras:
 * 1. currentStreak e previousStreak devem ser números válidos.
 * 2. previousStreak deve ser > 1 (primeira execução ou dia 1 não tem histórico prévio de sequência quebrável).
 * 3. Se alreadyCollected, trata-se de re-execução no mesmo dia: a sequência já foi garantida e NUNCA quebra.
 * 4. No AliExpress, um streak quebrado sempre reseta para o Dia 1 (+10 moedas).
 *    Leituras intermediárias como 7 quando o streak anterior era > 7 (ex: 212 -> 7) são leituras do widget de 7 dias da semana,
 *    NUNCA uma quebra de sequência real.
 * 5. Quebra real: currentStreak === 1 quando previousStreak > 1 e !alreadyCollected.
 * @param {number|null} currentStreak
 * @param {number|null} previousStreak
 * @param {boolean} [alreadyCollected=false]
 * @returns {boolean}
 */
function isStreakBreak(currentStreak, previousStreak, alreadyCollected = false) {
  if (typeof currentStreak !== 'number' || isNaN(currentStreak)) return false;
  if (typeof previousStreak !== 'number' || isNaN(previousStreak)) return false;
  if (previousStreak <= 1) return false;

  // Se já foi coletado hoje (re-execução no mesmo dia), a sequência já foi garantida
  if (alreadyCollected) {
    return false;
  }

  // Leituras intermediárias (ex: 7 quando anterior era 212) são do ciclo semanal de 7 dias do AliExpress, nunca quebra real
  if (currentStreak > 1 && currentStreak < previousStreak) {
    return false;
  }

  // Quebra real de sequência: retorno ao dia 1 após histórico anterior > 1
  if (currentStreak === 1 && previousStreak > 1) {
    return true;
  }

  return false;
}

/**
 * Resolve o valor final de `streakDays` para o check-in, aplicando:
 *  - incremento determinístico (+1) quando o check-in acabou de ser feito hoje;
 *  - preservação do streak consolidado em re-execução no mesmo dia;
 *  - proteção contra leitura espúria do ciclo semanal (<= 7 com base > 7);
 *  - fallback para `earlyDesktopStreak` quando o meta local não tem histórico.
 *
 * @param {object} params
 * @param {number|string|null} params.detectedStreak Valor lido na tela (mobile/desktop)
 * @param {number|null} params.previousStreakDays Último streak persistido nos metadados
 * @param {number|null} [params.earlyDesktopStreak=null] Streak lido no desktop pré-check-in
 * @param {boolean} [params.justCollected=false] Check-in recém-realizado nesta execução
 * @param {boolean} [params.alreadyCollected=false] Check-in já constava como feito hoje
 * @returns {{ streakDays: number|string, baseStreak: number|null }}
 */
function resolveStreakDays({
  detectedStreak,
  previousStreakDays,
  earlyDesktopStreak = null,
  justCollected = false,
  alreadyCollected = false
}) {
  const numericCandidates = [previousStreakDays, earlyDesktopStreak].filter(
    (v) => typeof v === 'number' && v > 0
  );
  const baseStreak = numericCandidates.length > 0 ? Math.max(...numericCandidates) : null;

  const parsedDetected =
    typeof detectedStreak === 'number'
      ? detectedStreak
      : parseInt(String(detectedStreak).replace(/[^0-9]/g, ''), 10);

  let streakDays = detectedStreak !== null && detectedStreak !== undefined ? detectedStreak : 'N/D';

  if (typeof baseStreak === 'number' && baseStreak > 0) {
    const isSpuriousWeeklyCycle =
      !isNaN(parsedDetected) && baseStreak > 7 && parsedDetected <= 7 && parsedDetected > 1;

    if (justCollected) {
      if (
        detectedStreak === null ||
        detectedStreak === undefined ||
        isNaN(parsedDetected) ||
        isSpuriousWeeklyCycle ||
        parsedDetected <= baseStreak
      ) {
        streakDays = baseStreak + 1;
      } else {
        streakDays = parsedDetected;
      }
    } else if (alreadyCollected) {
      if (
        detectedStreak === null ||
        detectedStreak === undefined ||
        isNaN(parsedDetected) ||
        isSpuriousWeeklyCycle ||
        parsedDetected < baseStreak
      ) {
        streakDays = baseStreak;
      } else {
        streakDays = parsedDetected;
      }
    } else {
      streakDays = !isNaN(parsedDetected) ? parsedDetected : baseStreak;
    }
  } else if (justCollected) {
    streakDays = !isNaN(parsedDetected) && parsedDetected >= 1 ? parsedDetected : 1;
  }

  return { streakDays, baseStreak };
}

/**
 * Calcula as moedas ganhas no check-in para os relatórios.
 * IMPORTANTE: quando `alreadyCollected` é true, `coinsGainedToday` é apenas um eco
 * informativo do check-in já realizado (não é ganho desta execução) e deve ser ignorado.
 * Esta função é compartilhada entre os caminhos unificado e multi-conta para que o
 * cálculo não volte a divergir por cópia de código.
 * @param {object|null} checkin
 * @returns {number}
 */
function computeCheckinCoinsGained(checkin) {
  if (!checkin) return 0;
  // Valor vindo do extrato de HOJE: é o crédito real do dia e deve ser contabilizado
  // mesmo que o check-in já constasse como coletado (ex.: feito pelo usuário no app).
  if (checkin.checkinCoinsFromLedger === true) {
    const fromLedger = parseInt(String(checkin.coinsGainedToday || '').replace(/[^0-9]/g, ''), 10);
    if (!isNaN(fromLedger) && fromLedger > 0) return fromLedger;
  }
  if (checkin.alreadyCollected !== false) {
    return 0;
  }
  if (checkin.coinsGainedToday && checkin.coinsGainedToday !== 'N/D') {
    const parsed = parseInt(String(checkin.coinsGainedToday).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  // Fallback se coinsGainedToday for ausente/N/D mas streakDays estiver presente
  if (checkin.streakDays && checkin.streakDays !== 'N/D') {
    const fromStreak = getCheckinCoinsFromStreak(checkin.streakDays);
    if (typeof fromStreak === 'number' && fromStreak > 0) return fromStreak;
  }
  return 0;
}

/**
 * Calcula as moedas ganhas pelas tarefas, de forma ISOLADA do check-in.
 *
 * Como o ganho das tarefas é medido por diferença de saldo (final - inicial) e o
 * `initialBalance` é capturado em `all.js` a partir de `checkinResult.totalBalance`,
 * precisamos descontar o check-in apenas quando esse saldo inicial NÃO refletia o
 * crédito do check-in (saldo pré-crédito). Caso contrário o valor do check-in
 * apareceria somado ao extrato das tarefas.
 *
 * Regras (compatíveis com os formatos antigos):
 *  1. `checkin.totalBalance` é explícito como pré-crédito → desconta.
 *  2. `initialBalance` corresponder a `totalBalance - checkinCoins` → desconta (legado).
 *
 * O check-in em si é contabilizado exclusivamente por `computeCheckinCoinsGained`,
 * que retorna 0 quando `alreadyCollected === true` (já ocorreu no dia).
 * @param {object|null} tasks
 * @param {object|null} [checkin=null]
 * @returns {number}
 */
function computeTasksCoinsGained(tasks, checkin = null) {
  if (!tasks || typeof tasks.coinsGained !== 'number' || !Number.isFinite(tasks.coinsGained)) {
    return 0;
  }
  const rawCoins = tasks.coinsGained;
  // Quando o ganho veio do extrato ("Missões de moedas"), ele já está isolado do check-in.
  if (tasks.coinsFromLedger === true) return rawCoins;
  if (!checkin) return rawCoins;

  const checkinCoins = computeCheckinCoinsGained(checkin);
  if (checkinCoins <= 0) return rawCoins;

  const initBal = parseInt(String(tasks.initialBalance || '').replace(/\D/g, ''), 10);
  const checkinBal = parseInt(String(checkin.totalBalance || '').replace(/\D/g, ''), 10);

  // Legado: saldo inicial das tarefas capturado ANTES do crédito do check-in
  if (!isNaN(initBal) && !isNaN(checkinBal) && initBal === checkinBal - checkinCoins) {
    return Math.max(0, rawCoins - checkinCoins);
  }

  // Sinal explícito de que o saldo informado é pré-crédito do check-in
  // (compatibilidade com consumidores que o definam)
  if (checkin.balanceBeforeCheckin === true) {
    return Math.max(0, rawCoins - checkinCoins);
  }

  return rawCoins;
}

/**
 * Resolve o saldo final consolidado (tarefas > check-in > 'N/D')
 * @param {object|null} checkin
 * @param {object|null} tasks
 * @returns {string}
 */
function computeFinalBalance(checkin, tasks) {
  if (tasks && tasks.finalCoins && tasks.finalCoins !== 'N/D') {
    return tasks.finalCoins;
  }
  if (checkin && checkin.totalBalance && checkin.totalBalance !== 'N/D') {
    return `${checkin.totalBalance} moedas`;
  }
  return 'N/D';
}

/**
 * Constrói o objeto estruturado do relatório unificado
 * @param {object} checkinResult
 * @param {object} tasksResult
 * @param {object} meta
 * @returns {object}
 */
function buildUnifiedReportPayload(checkinResult, tasksResult, meta = {}) {
  const finalBalance = computeFinalBalance(checkinResult, tasksResult);
  const checkinCoinsGained = computeCheckinCoinsGained(checkinResult);
  const tasksCoinsGained = computeTasksCoinsGained(tasksResult, checkinResult);
  const totalCoinsGained = checkinCoinsGained + tasksCoinsGained;

  let totalDuration = meta.totalDuration;
  if (!totalDuration || totalDuration === '0s') {
    if (meta.mainStartTime && meta.mainEndTime) {
      const ms = new Date(meta.mainEndTime) - new Date(meta.mainStartTime);
      if (ms > 0) totalDuration = formatDuration(ms);
    }
  }
  if (!totalDuration || totalDuration === '0s') {
    if (checkinResult?.startTime && tasksResult?.endTime) {
      const ms = new Date(tasksResult.endTime) - new Date(checkinResult.startTime);
      if (ms > 0) totalDuration = formatDuration(ms);
    } else if (
      checkinResult?.duration &&
      checkinResult.duration !== '0s' &&
      (!tasksResult || !tasksResult.duration || tasksResult.duration === '0s')
    ) {
      totalDuration = checkinResult.duration;
    } else if (
      tasksResult?.duration &&
      tasksResult.duration !== '0s' &&
      (!checkinResult || !checkinResult.duration || checkinResult.duration === '0s')
    ) {
      totalDuration = tasksResult.duration;
    }
  }
  if (!totalDuration) {
    totalDuration = meta.totalDuration || '0s';
  }

  let step1Duration = meta.step1Duration;
  if (!step1Duration || step1Duration === '0s') {
    if (checkinResult?.duration && checkinResult.duration !== '0s') {
      step1Duration = checkinResult.duration;
    }
  }

  let step2Duration = meta.step2Duration;
  if (!step2Duration || step2Duration === '0s') {
    if (tasksResult?.duration && tasksResult.duration !== '0s') {
      step2Duration = tasksResult.duration;
    }
  }

  return {
    type: 'unified_report',
    user:
      meta.user ||
      (checkinResult ? checkinResult.userEmail : tasksResult ? tasksResult.userEmail : undefined),
    checkin: checkinResult
      ? {
          alreadyCollected: checkinResult.alreadyCollected,
          coinsGainedToday: checkinResult.coinsGainedToday,
          streakDays: checkinResult.streakDays,
          previousStreakDays: checkinResult.previousStreakDays,
          totalBalance: checkinResult.totalBalance,
          duration: checkinResult.duration
        }
      : null,
    tasks: tasksResult
      ? {
          results: tasksResult.results,
          initialBalance: tasksResult.initialBalance,
          finalBalance: tasksResult.finalBalance,
          coinsGained: tasksResult.coinsGained,
          finalCoins: tasksResult.finalCoins,
          duration: tasksResult.duration
        }
      : null,
    meta: {
      startTime: meta.mainStartTime ? meta.mainStartTime.toISOString() : undefined,
      endTime: meta.mainEndTime ? meta.mainEndTime.toISOString() : undefined,
      totalDuration,
      step1Duration,
      step2Duration,
      finalBalance,
      totalCoinsGained,
      checkinCoinsGained,
      tasksCoinsGained,
      tasksError: meta.tasksError
    }
  };
}

/**
 * Envia notificação para Webhook genérico (Discord/Telegram/HTTP POST) com timeout de 5s
 * Nunca lança erro ou interrompe o fluxo de execução
 * @param {object} payload
 * @param {string} [customUrl]
 * @returns {Promise<boolean>}
 */
// Rastreamento de webhooks em voo vive em módulo leve (sem Playwright), consumido
// também por libs/exit.js para flush no encerramento.
const { trackWebhook, flushWebhooks } = require('./webhooks');

/**
 * Envia notificação para webhook, registrando a promessa em voo para flush no encerramento.
 * @param {object} payload
 * @param {string} [customUrl]
 * @returns {Promise<boolean>}
 */
function sendWebhookNotification(payload, customUrl = null) {
  return trackWebhook(performWebhookNotification(payload, customUrl));
}

// Chaves que NUNCA devem sair para webhooks externos (contêm segredos de sessão).
const WEBHOOK_FORBIDDEN_KEYS = new Set(['sessionData', 'session', 'cookies', 'storageState']);
// Chaves de identificação de conta que devem ser mascaradas antes do envio externo.
const WEBHOOK_USER_KEYS = new Set(['user', 'userEmail', 'email', 'maskedUser', 'account']);

/**
 * Sanitiza o payload antes do envio a webhooks externos (defesa em profundidade):
 * - remove campos com segredos de sessão (cookies/storageState);
 * - mascara e-mails em campos de usuário conhecidos (não toca em outras strings).
 * @param {*} value
 * @param {number} [depth=0]
 * @param {boolean} [userContext=false] Indica que o valor está sob uma chave de usuário
 * @returns {*}
 */
function sanitizeWebhookPayload(value, depth = 0, userContext = false) {
  // Limite duro de profundidade: em vez de devolver o objeto cru (vazaria segredos),
  // retorna um marcador — a defesa em profundidade não pode ser contornada por aninhamento.
  if (depth > 6) return '[profundidade máxima excedida]';
  if (value === null || typeof value !== 'object') {
    // Mascara QUALQUER identificador em contexto de usuário (e-mail OU telefone/ID).
    // Antes exigia '@', deixando logins por telefone vazarem para o webhook externo.
    if (userContext && typeof value === 'string') return maskUser(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWebhookPayload(item, depth + 1, userContext));
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (WEBHOOK_FORBIDDEN_KEYS.has(key)) continue;
    // `account` pode ser um objeto { user, maskedUser } — entra em contexto de usuário.
    const childUserContext = userContext || WEBHOOK_USER_KEYS.has(key);
    out[key] = sanitizeWebhookPayload(val, depth + 1, childUserContext);
  }
  return out;
}

async function performWebhookNotification(payload, customUrl = null) {
  const webhookUrl = customUrl || process.env.NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) return false;

  // Remove segredos de sessão e mascara PII antes de qualquer envio externo.
  payload = sanitizeWebhookPayload(payload);

  try {
    // Proteção contra SSRF: só envia para http(s) público (bloqueia loopback/privado),
    // salvo opt-in explícito em ALLOW_PRIVATE_WEBHOOKS=true.
    const guard = await validateExternalUrl(webhookUrl);
    if (!guard.ok) {
      logger.warn(
        { reason: guard.reason },
        'Webhook não enviado: destino bloqueado pela validação de segurança (SSRF).'
      );
      return false;
    }

    const isDiscord = webhookUrl.includes('discord.com/api/webhooks');
    const isTelegram = webhookUrl.includes('api.telegram.org/bot');

    /**
     * Neutraliza markdown e menções do Discord em valores derivados da página raspada
     * (evita spoof de formatação e ping de @everyone/@here/roles).
     * @param {*} v
     * @returns {string}
     */
    const escapeDiscord = (v) =>
      String(v)
        .replace(/\\/g, '\\\\')
        .replace(/([*_`~|])/g, '\\$1')
        .replace(/@(?=everyone|here|&)/g, '@\u200b');

    // Teto de payload: evita enviar corpos gigantes (multi-conta grande) e picos de memória.
    let bodyData = JSON.stringify(payload);
    if (bodyData.length > WEBHOOK_MAX_PAYLOAD_BYTES) {
      logger.warn(
        { size: bodyData.length, limit: WEBHOOK_MAX_PAYLOAD_BYTES },
        'Payload do webhook excede o limite; enviando versão truncada.'
      );
      bodyData = JSON.stringify({
        truncated: true,
        originalSize: bodyData.length,
        note: `Payload original excedeu ${WEBHOOK_MAX_PAYLOAD_BYTES} bytes`,
        summary: payload.meta || null
      });
    }
    const headers = { 'Content-Type': 'application/json' };

    const targetUser =
      payload.user ||
      (payload.meta?.totalAccounts
        ? `${payload.meta.successfulAccounts}/${payload.meta.totalAccounts} contas`
        : 'N/D');
    const targetBalance =
      payload.meta?.finalBalance ||
      payload.finalCoins ||
      payload.totalBalance ||
      (payload.meta?.totalAccounts ? `${payload.meta.successfulAccounts} contas OK` : 'N/D');

    if (isDiscord) {
      let coinsText = 'N/D';
      if (typeof payload.meta?.totalCoinsGained === 'number') {
        coinsText = `+${payload.meta.totalCoinsGained} moedas (check-in +${payload.meta.checkinCoinsGained || 0} / tarefas +${payload.meta.tasksCoinsGained || 0})`;
      } else if (payload.coinsGainedToday !== undefined || payload.alreadyCollected !== undefined) {
        const checkinCoins = computeCheckinCoinsGained(payload);
        coinsText = `+${checkinCoins} moedas`;
      } else if (typeof payload.coinsGained === 'number') {
        coinsText = `+${payload.coinsGained} moedas`;
      }

      const summaryText =
        `**AliExpress Coins Report** (${escapeDiscord(payload.type || 'relatório')})\n` +
        `Conta: ${escapeDiscord(targetUser)}\n` +
        `Ganhas hoje: ${escapeDiscord(coinsText)}\n` +
        `Saldo: ${escapeDiscord(targetBalance)}`;
      bodyData = JSON.stringify({
        content: summaryText,
        embeds: [
          {
            title: 'Relatório AliExpress Moedas',
            description: 'Execução concluída com sucesso.',
            fields: [
              { name: 'Tipo', value: escapeDiscord(payload.type || 'N/D'), inline: true },
              { name: 'Conta', value: escapeDiscord(targetUser), inline: true },
              { name: 'Ganhas hoje', value: escapeDiscord(coinsText), inline: true },
              { name: 'Saldo', value: escapeDiscord(targetBalance), inline: true },
              {
                name: 'Duração',
                value: escapeDiscord(payload.meta?.totalDuration || payload.duration || 'N/D'),
                inline: true
              }
            ]
          }
        ]
      });
    } else if (isTelegram) {
      let coinsText = '';
      if (typeof payload.meta?.totalCoinsGained === 'number') {
        coinsText = `\nGanhas hoje: +${payload.meta.totalCoinsGained} (check-in +${payload.meta.checkinCoinsGained || 0} / tarefas +${payload.meta.tasksCoinsGained || 0})`;
      }
      const text = `AliExpress Coins (${payload.type})\nConta: ${targetUser}${coinsText}\nSaldo: ${targetBalance}`;
      bodyData = JSON.stringify({ text });
    }

    // B8: teto por BYTES (não por code units UTF-16). O length de string pode ser ~3×
    // menor que os bytes reais em conteúdo multibyte.
    if (Buffer.byteLength(bodyData, 'utf8') > WEBHOOK_MAX_PAYLOAD_BYTES) {
      logger.warn(
        { size: Buffer.byteLength(bodyData, 'utf8'), limit: WEBHOOK_MAX_PAYLOAD_BYTES },
        'Payload final do webhook excede o limite em bytes; enviando versão truncada.'
      );
      bodyData = JSON.stringify({
        truncated: true,
        note: `Payload excedeu ${WEBHOOK_MAX_PAYLOAD_BYTES} bytes`,
        summary: payload?.meta || null
      });
    }

    // safeFetch revalida CADA hop de redirect com o guard SSRF e não segue redirects
    // para rede privada/metadata (o fetch nativo seguiria, contornando o guard).
    let response;
    try {
      response = await safeFetch(webhookUrl, {
        method: 'POST',
        headers,
        body: bodyData,
        signal: AbortSignal.timeout(5000)
      });
    } catch (err) {
      if (err && err.code === 'SSRF_BLOCKED') {
        logger.warn(
          { reason: err.reason },
          'Webhook abortado: destino (ou redirect) apontou para rede privada (SSRF).'
        );
        return false;
      }
      throw err;
    }

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        'Webhook notification retornou status não-2xx.'
      );
      return false;
    }
    logger.info('Notificação via Webhook enviada com sucesso.');
    return true;
  } catch (err) {
    logger.debug(
      { err: err.message },
      'Falha silenciosa ao enviar notificação webhook (job preservado).'
    );
    return false;
  }
}

/**
 * Renderiza o relatório do check-in diário
 * @param {object} checkinResult
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderCheckinReport(checkinResult, options = {}) {
  if (options.json) {
    const payload = { type: 'checkin', ...checkinResult };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    // Mascara o e-mail antes de enviar a webhooks de terceiros (Discord/Telegram) — o stdout
    // local mantém o valor cru, que é o comportamento já esperado por quem consome --json.
    const webhookPayload = {
      ...payload,
      userEmail: checkinResult.userEmail
        ? maskUser(checkinResult.userEmail)
        : checkinResult.userEmail
    };
    sendWebhookNotification(webhookPayload).catch(() => {});
    return;
  }

  const checkinGained = computeCheckinCoinsGained(checkinResult);
  const reportLine1 = checkinResult.alreadyCollected
    ? 'já estava coletado (+0 moedas)'
    : `${checkinGained > 0 ? checkinGained : checkinResult.coinsGainedToday} moedas`;
  const reportLine2 = `${checkinResult.totalBalance} moedas`;
  const reportLine3 =
    checkinResult.streakDays !== 'N/D'
      ? `a sequência subiu (${checkinResult.streakDays} dias seguidos)`
      : 'sequência não identificada na página';

  logger.info('=== RELATORIO_OUTPUT ===');
  logger.info(reportLine1);
  logger.info(reportLine2);
  logger.info(reportLine3);
  logger.info('---------------------------------------------------------------');
  logger.info(`Data:                ${formatDate(checkinResult.startTime)}`);
  logger.info(`Hora de Início:      ${formatTime(checkinResult.startTime)}`);
  logger.info(`Hora de Finalização: ${formatTime(checkinResult.endTime)}`);
  logger.info(`Duração Total:       ${checkinResult.duration}`);
  logger.info('===============================================================\n');

  sendWebhookNotification({
    type: 'checkin',
    alreadyCollected: checkinResult.alreadyCollected,
    totalBalance: checkinResult.totalBalance,
    duration: checkinResult.duration
  }).catch(() => {});
}

/**
 * Renderiza o relatório de tarefas diárias
 * @param {object} tasksResult
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderTasksReport(tasksResult, options = {}) {
  if (options.json) {
    const payload = { type: 'tasks', ...tasksResult };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    // Mascara o e-mail antes de enviar a webhooks de terceiros (mesma política do check-in);
    // o stdout local mantém o valor cru para quem consome --json.
    const webhookPayload = {
      ...payload,
      userEmail: payload.userEmail ? maskUser(payload.userEmail) : payload.userEmail
    };
    sendWebhookNotification(webhookPayload).catch(() => {});
    return;
  }

  logger.info('\n================ RESUMO DAS TAREFAS ================');
  if (Array.isArray(tasksResult.results)) {
    for (const r of tasksResult.results) {
      logger.info(`- ${r.title}: ${r.status} (${r.coins || ''})`);
    }
  }
  logger.info(`\nSaldo total final: ${tasksResult.finalCoins}`);
  logger.info('----------------------------------------------------');
  logger.info(`Data:                ${formatDate(tasksResult.startTime)}`);
  logger.info(`Hora de Início:      ${formatTime(tasksResult.startTime)}`);
  logger.info(`Hora de Finalização: ${formatTime(tasksResult.endTime)}`);
  logger.info(`Duração Total:       ${tasksResult.duration}`);
  logger.info('====================================================\n');

  sendWebhookNotification({
    type: 'tasks',
    finalCoins: tasksResult.finalCoins,
    duration: tasksResult.duration
  }).catch(() => {});
}

/**
 * Renderiza o relatório consolidado final (modo unificado all.js)
 * @param {object} checkinResult
 * @param {object} tasksResult
 * @param {object} meta
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderUnifiedReport(checkinResult, tasksResult, meta = {}, options = {}) {
  const jsonOutput = buildUnifiedReportPayload(checkinResult, tasksResult, meta);

  if (options.json) {
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    sendWebhookNotification(jsonOutput).catch(() => {});
    return;
  }

  logger.info('\n===============================================================');
  logger.info('                RELATÓRIO CONSOLIDADO FINAL');
  logger.info('===============================================================');

  if (checkinResult) {
    const dailyTier =
      (checkinResult.streakDays && checkinResult.streakDays !== 'N/D'
        ? getCheckinCoinsFromStreak(checkinResult.streakDays)
        : null) ||
      (checkinResult.coinsGainedToday && checkinResult.coinsGainedToday !== '0'
        ? checkinResult.coinsGainedToday
        : 70);

    logger.info(`Conta: ${maskUser(checkinResult.userEmail)}`);
    logger.info(
      `Sequência (Streak): ${checkinResult.streakDays} dias seguidos (+${dailyTier} moedas/dia)`
    );
    const checkinGained =
      jsonOutput.meta.checkinCoinsGained ?? computeCheckinCoinsGained(checkinResult);
    logger.info(
      `Check-in Diário: ${checkinResult.alreadyCollected ? 'Já coletado hoje (+0 moedas)' : `Coletado com sucesso (+${checkinGained} moedas)`}`
    );
  }

  if (tasksResult && tasksResult.results) {
    logger.info('\nTarefas do Painel "Ganhe mais moedas":');
    for (const r of tasksResult.results) {
      logger.info(`  • ${r.title}: ${r.status} (${r.coins || r.estimatedCoins || ''})`);
    }
    logger.info(
      `Ganho Real pelas Tarefas: +${jsonOutput.meta.tasksCoinsGained ?? tasksResult.coinsGained ?? 0} moedas`
    );
  }

  logger.info('---------------------------------------------------------------');
  logger.info(
    `Moedas Ganhas Hoje:     +${jsonOutput.meta.totalCoinsGained || 0} moedas (check-in +${jsonOutput.meta.checkinCoinsGained || 0} / tarefas +${jsonOutput.meta.tasksCoinsGained || 0})`
  );
  logger.info(`Saldo Total Atualizado: ${jsonOutput.meta.finalBalance}`);
  logger.info('---------------------------------------------------------------');
  if (meta.mainStartTime && meta.mainEndTime) {
    logger.info(`Data:                ${formatDate(meta.mainStartTime)}`);
    logger.info(`Hora de Início:      ${formatTime(meta.mainStartTime)}`);
    logger.info(`Hora de Finalização: ${formatTime(meta.mainEndTime)}`);
  }
  if (meta.step1Duration) logger.info(`Duração Etapa 1:     ${meta.step1Duration}`);
  if (meta.step2Duration) logger.info(`Duração Etapa 2:     ${meta.step2Duration}`);
  if (meta.totalDuration) logger.info(`Duração Total:       ${meta.totalDuration}`);
  logger.info('===============================================================\n');

  sendWebhookNotification(jsonOutput).catch(() => {});
}

/**
 * Constrói o objeto estruturado do relatório multi-conta
 * @param {Array<{ account?: object, user?: string, checkinResult?: object, tasksResult?: object, error?: string }>} accountResults
 * @param {object} meta
 * @returns {object}
 */
function buildMultiAccountReportPayload(accountResults = [], meta = {}) {
  const accounts = accountResults.map((item) => {
    const checkin = item.checkinResult;
    const tasks = item.tasksResult;
    const finalBalance = computeFinalBalance(checkin, tasks);
    // Mesmo cálculo compartilhado do relatório unificado: respeita alreadyCollected e isola moedas do check-in
    const checkinCoinsGained = computeCheckinCoinsGained(checkin);
    const tasksCoinsGained = computeTasksCoinsGained(tasks, checkin);
    const totalCoinsGained = checkinCoinsGained + tasksCoinsGained;

    let accountDuration = item.duration;
    if (!accountDuration || accountDuration === '0s') {
      if (item.startTime && item.endTime) {
        const ms = new Date(item.endTime) - new Date(item.startTime);
        if (ms > 0) accountDuration = formatDuration(ms);
      }
    }
    if (!accountDuration || accountDuration === '0s') {
      if (checkin?.startTime && tasks?.endTime) {
        const ms = new Date(tasks.endTime) - new Date(checkin.startTime);
        if (ms > 0) accountDuration = formatDuration(ms);
      } else if (
        checkin?.duration &&
        checkin.duration !== '0s' &&
        (!tasks || !tasks.duration || tasks.duration === '0s')
      ) {
        accountDuration = checkin.duration;
      } else if (
        tasks?.duration &&
        tasks.duration !== '0s' &&
        (!checkin || !checkin.duration || checkin.duration === '0s')
      ) {
        accountDuration = tasks.duration;
      }
    }

    return {
      user: item.account ? item.account.maskedUser : item.user || 'Desconhecido',
      checkin: checkin
        ? {
            alreadyCollected: checkin.alreadyCollected,
            coinsGainedToday: checkin.coinsGainedToday,
            streakDays: checkin.streakDays,
            previousStreakDays: checkin.previousStreakDays,
            totalBalance: checkin.totalBalance,
            duration: checkin.duration
          }
        : null,
      tasks: tasks
        ? {
            results: tasks.results,
            initialBalance: tasks.initialBalance,
            finalBalance: tasks.finalBalance,
            coinsGained: tasks.coinsGained,
            finalCoins: tasks.finalCoins,
            duration: tasks.duration
          }
        : null,
      error: item.error || undefined,
      // Preserva a falha da etapa de tarefas (check-in OK) para o alerta consolidado
      tasksError: item.tasksError || undefined,
      // Preserva o sinal de sessão importada expirada para o alerta consolidado do Telegram
      isImportedSessionExpired: Boolean(item.isImportedSessionExpired),
      duration: accountDuration,
      meta: {
        finalBalance,
        totalCoinsGained,
        checkinCoinsGained,
        tasksCoinsGained,
        tasksError: item.tasksError || undefined
      }
    };
  });

  const successfulAccounts = accountResults.filter((a) => !a.error).length;

  let totalDuration = meta.totalDuration;
  if (!totalDuration || totalDuration === '0s') {
    if (meta.mainStartTime && meta.mainEndTime) {
      const ms = new Date(meta.mainEndTime) - new Date(meta.mainStartTime);
      if (ms > 0) totalDuration = formatDuration(ms);
    }
  }

  return {
    type: 'multi_account_report',
    accounts,
    meta: {
      startTime: meta.mainStartTime ? meta.mainStartTime.toISOString() : undefined,
      endTime: meta.mainEndTime ? meta.mainEndTime.toISOString() : undefined,
      totalDuration,
      totalAccounts: accountResults.length,
      successfulAccounts
    }
  };
}

/**
 * Renderiza o relatório consolidado final multi-conta
 * @param {Array<object>} accountResults
 * @param {object} meta
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderMultiAccountReport(accountResults = [], meta = {}, options = {}) {
  const jsonOutput = buildMultiAccountReportPayload(accountResults, meta);

  if (options.json) {
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    sendWebhookNotification(jsonOutput).catch(() => {});
    return;
  }

  logger.info('\n===============================================================');
  logger.info(`       RELATÓRIO CONSOLIDADO FINAL - MULTI-CONTA (${accountResults.length} contas)`);
  logger.info('===============================================================');

  accountResults.forEach((res, idx) => {
    const userDisplay = res.account ? res.account.maskedUser : res.user || `Conta ${idx + 1}`;
    logger.info(`\n[Conta ${idx + 1}/${accountResults.length}]: ${userDisplay}`);
    if (res.error) {
      logger.info(`  • Status: FALHA (${res.error})`);
      return;
    }

    const accMeta = jsonOutput.accounts[idx]?.meta;

    if (res.checkinResult) {
      const dailyTier =
        (res.checkinResult.streakDays && res.checkinResult.streakDays !== 'N/D'
          ? getCheckinCoinsFromStreak(res.checkinResult.streakDays)
          : null) ||
        (res.checkinResult.coinsGainedToday && res.checkinResult.coinsGainedToday !== '0'
          ? res.checkinResult.coinsGainedToday
          : 70);

      logger.info(
        `  • Sequência (Streak): ${res.checkinResult.streakDays} dias (+${dailyTier} moedas/dia)`
      );
      const accCheckinGained =
        accMeta?.checkinCoinsGained ?? computeCheckinCoinsGained(res.checkinResult);
      logger.info(
        `  • Check-in: ${res.checkinResult.alreadyCollected ? 'Já coletado (+0 moedas)' : `Coletado com sucesso (+${accCheckinGained} moedas)`}`
      );
    }

    if (res.tasksResult && res.tasksResult.results) {
      // totalActions conta ações executadas de fato; results inclui tarefas puladas/desativadas.
      const executedTasks = res.tasksResult.totalActions ?? res.tasksResult.results.length;
      logger.info(`  • Tarefas executadas: ${executedTasks}`);
      for (const r of res.tasksResult.results) {
        logger.info(`    - ${r.title}: ${r.status} (${r.coins || ''})`);
      }
    }

    const finalBal =
      res.tasksResult && res.tasksResult.finalCoins && res.tasksResult.finalCoins !== 'N/D'
        ? res.tasksResult.finalCoins
        : res.checkinResult
          ? `${res.checkinResult.totalBalance} moedas`
          : 'N/D';
    logger.info(`  • Saldo Final: ${finalBal}`);

    if (accMeta) {
      logger.info(
        `  • Moedas Ganhas Hoje: +${accMeta.totalCoinsGained || 0} moedas (check-in +${accMeta.checkinCoinsGained || 0} / tarefas +${accMeta.tasksCoinsGained || 0})`
      );
    }
  });

  logger.info('\n---------------------------------------------------------------');
  if (meta.mainStartTime && meta.mainEndTime) {
    logger.info(`Data:                ${formatDate(meta.mainStartTime)}`);
    logger.info(`Hora de Início:      ${formatTime(meta.mainStartTime)}`);
    logger.info(`Hora de Finalização: ${formatTime(meta.mainEndTime)}`);
  }
  if (meta.totalDuration) logger.info(`Duração Total:       ${meta.totalDuration}`);
  logger.info('===============================================================\n');

  sendWebhookNotification(jsonOutput).catch(() => {});
}

module.exports = {
  unifiedReportSchema,
  multiAccountReportSchema,
  computeCheckinCoinsGained,
  computeTasksCoinsGained,
  computeFinalBalance,
  buildUnifiedReportPayload,
  buildMultiAccountReportPayload,
  sendWebhookNotification,
  flushWebhooks,
  renderCheckinReport,
  renderTasksReport,
  renderUnifiedReport,
  renderMultiAccountReport,
  isStreakBreak,
  resolveStreakDays,
  sanitizeWebhookPayload
};
