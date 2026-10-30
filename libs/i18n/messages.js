'use strict';

/**
 * Catálogo de IDs estáveis de mensagens (id → { pt, en }).
 *
 * O catálogo de logs legado (`log-catalog.js`) continua sendo a fonte das traduções
 * existentes. Este arquivo dá nomes semânticos às mensagens já migradas e gera IDs de
 * compatibilidade determinísticos (`legacy.<hash>`) para todas as demais, permitindo
 * que o logger e os testes tratem toda mensagem como registrada.
 *
 * Regras:
 *  - IDs são contrato público: renomear remove a compatibilidade com filtros/alertas.
 *  - `pt` precisa existir no catálogo legado (exact ou template) para evitar tradução órfã.
 *  - Mensagens novas devem entrar aqui com ID semântico, não como `legacy.*`.
 */

const crypto = require('crypto');
const catalog = require('./log-catalog');

/**
 * Mensagens priorizadas na Frente 2: session-check, login, streak e importação.
 * A chave é o ID estável; o valor é a mensagem PT canônica já usada no código.
 */
const SEMANTIC_MESSAGES = {
  // session-check
  'session.check.not_found': 'Conta não encontrada para --check-session.',
  'session.check.valid': 'Sessão válida (somente leitura).',
  'session.check.invalid': '[Sessão Inválida] A checagem somente leitura falhou.',
  'session.check.summary': '[{{0}}] {{1}} — {{2}}',

  // login
  'login.credentials': '[Login] Autenticando com credenciais de "{{0}}"...',
  'login.password_prompt': '[Login] Prompt de reautenticação in-page detectado (somente senha).',
  'login.risk_rejected':
    'Login rejeitado pelo controle de risco do AliExpress (RGV587/FAIL_SYS_USER_VALIDATE).',
  'login.2fa_requested':
    '[Segurança AliExpress] Código de verificação 2FA solicitado pelo AliExpress.',
  'login.failed': 'Falha ao autenticar conta no AliExpress (desafio de segurança não superado).',
  'login.session_saved': '[Login] Nova sessão autenticada salva com sucesso.',

  // check-in / streak
  'checkin.streak.ui_unconfirmed':
    'Clique de check-in não confirmado pela UI (marcador de "hoje" ausente). Não contabilizando como coletado nesta execução.',
  'checkin.streak.reused_early_desktop':
    'Saldo/streak reutilizados da checagem inicial do desktop (sem nova leitura).',
  'checkin.streak.confirm_statement':
    'Leitura de streak = 1 com histórico anterior > 1; confirmando a quebra pelo extrato desktop...',
  'checkin.streak.statement_confirmed':
    'Extrato desmente a quebra (sequência do extrato > 1); preservando o streak real.',
  'checkin.streak.statement_not_confirmed':
    'Extrato não desmente a quebra (sequência do extrato <= 1 ou indisponível).',
  'checkin.streak.statement_failed':
    'Falha ao confirmar a quebra de streak pelo extrato; mantendo a leitura da tela.',
  'checkin.streak.calendar_lower':
    'A sequência lida no calendário é menor que o histórico local; adotando a sequência real do AliExpress.',
  'checkin.streak.credited_diff':
    'Valor do check-in creditado difere do tier sugerido pela UI; usando o valor real do extrato.',
  'checkin.streak.balance_synced':
    'Saldo pós-checkin sincronizado com as moedas recebidas no check-in (ledger defasado).',
  'checkin.streak.remote_session_expired':
    '[Sessão Remota Expirada] Não foi possível obter streak e saldo. A sessão importada de outro host expirou ou foi invalidada pelo AliExpress. Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".',
  'checkin.streak.login_failed': 'Erro ao efetuar o login: não foi possível obter streak e saldo.',
  'checkin.streak.login_prompt':
    'A página desktop exibiu um prompt de login/reautenticação (sessão inválida) — não é apenas mudança de layout.',

  // importação
  'import.header.single': '         IMPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM)',
  'import.header.multi': '   IMPORTAÇÃO MULTI-CONTA DE SESSÕES ALIEXPRESS',
  'import.processing_token': 'Processando arquivo de token: {{0}}...',
  'import.session_valid':
    '[SUCESSO] Sessão autenticada descriptografada e validada para a conta: "{{0}}"{{1}}!',
  'import.export_date': '[SUCESSO] Data de exportação original: {{0}}',
  'import.validity': '[SUCESSO] Validade estimada da sessão: até {{0}}',
  'import.file_encrypted':
    '[SUCESSO] Arquivo "{{0}}" gravado com permissão 0o600 ({{1}} cookies, criptografia AES-256-GCM at-rest).',
  'import.file_plaintext':
    '[SUCESSO] Arquivo "{{0}}" gravado com permissão 0o600 ({{1}} cookies, opt-out plaintext at-rest).',
  'import.file': '[SUCESSO] Arquivo "{{0}}" gravado com permissão 0o600.\n',
  'import.token_removed':
    'Token de sessão removido após importação bem-sucedida (use --keep-tokens para preservar).',
  'import.token_remove_failed': 'Não foi possível remover o arquivo de token após a importação.',
  'import.multi.done': '   IMPORTAÇÃO CONCLUÍDA: {{0}} CONTA(S) IMPORTADA(S)',
  'import.multi.account': ' • [Conta {{0}}] {{1}} <- {{2}} (salvo em {{3}})',
  'import.none': 'Nenhuma sessão foi importada.',
  'import.partial': 'Importação parcial: algumas contas não foram importadas.',
  'import.failed': 'Falha na importação da sessão.',
  'import.file_failed': 'Falha ao importar arquivo de token.'
};

/** @param {string} pt @returns {string|null} */
function lookupCatalogTranslation(pt) {
  if (Object.prototype.hasOwnProperty.call(catalog.exact, pt)) return catalog.exact[pt];
  const template = catalog.templates.find((entry) => entry.pt === pt);
  return template ? template.en : null;
}

/** @param {string} pt @returns {string} */
function legacyIdFor(pt) {
  return `legacy.${crypto.createHash('sha1').update(pt).digest('hex').slice(0, 12)}`;
}

/** @type {Record<string, {pt: string, en: string}>} */
const MESSAGES = {};
/** @type {Map<string, string>} */
const ID_BY_TEXT = new Map();
/** @type {Map<string, {id: string, pt: string, en: string}>} */
const ENTRY_BY_ID = new Map();

for (const [id, pt] of Object.entries(SEMANTIC_MESSAGES)) {
  const en = lookupCatalogTranslation(pt);
  if (en === null) {
    throw new Error(`Mensagem sem tradução no catálogo legado para o ID "${id}": ${pt}`);
  }
  const entry = { pt, en };
  MESSAGES[id] = entry;
  ID_BY_TEXT.set(pt, id);
  ENTRY_BY_ID.set(id, { id, ...entry });
}

for (const [pt, en] of Object.entries(catalog.exact)) {
  if (ID_BY_TEXT.has(pt)) continue;
  const id = legacyIdFor(pt);
  const entry = { pt, en };
  MESSAGES[id] = entry;
  ID_BY_TEXT.set(pt, id);
  ENTRY_BY_ID.set(id, { id, ...entry });
}

for (const template of catalog.templates) {
  if (ID_BY_TEXT.has(template.pt)) continue;
  const id = legacyIdFor(template.pt);
  const entry = { pt: template.pt, en: template.en };
  MESSAGES[id] = entry;
  ID_BY_TEXT.set(template.pt, id);
  ENTRY_BY_ID.set(id, { id, ...entry });
}

// Consumidores podem remover \n/espaços de banners; aceita a versão trimada sem
// sobrescrever um ID semântico já registrado.
for (const [pt, id] of [...ID_BY_TEXT.entries()]) {
  const trimmed = pt.trim();
  if (trimmed && !ID_BY_TEXT.has(trimmed)) ID_BY_TEXT.set(trimmed, id);
}

/**
 * Resolve o ID registrado de uma mensagem PT (semântico ou legado).
 * @param {string} text
 * @returns {string|null}
 */
function getMessageIdForText(text) {
  if (typeof text !== 'string' || !text) return null;
  return ID_BY_TEXT.get(text) || ID_BY_TEXT.get(text.trim()) || null;
}

/**
 * Busca uma entrada por ID.
 * @param {string} id
 * @returns {{id: string, pt: string, en: string}|null}
 */
function getMessage(id) {
  return ENTRY_BY_ID.get(id) || null;
}

/**
 * Formata uma mensagem registrada no idioma pedido.
 * Placeholders posicionais `{{n}}` aceitam array ou objeto.
 * @param {string} id
 * @param {'pt'|'en'} lang
 * @param {unknown[]|Record<string, unknown>} [vars=[]]
 * @returns {string|null}
 */
function formatMessage(id, lang, vars = []) {
  const entry = getMessage(id);
  if (!entry) return null;
  const template = lang === 'en' ? entry.en : entry.pt;
  return template.replace(/\{\{(\d+)\}\}/g, (_, rawIndex) => {
    const index = Number(rawIndex);
    const value = Array.isArray(vars)
      ? vars[index]
      : vars && typeof vars === 'object'
        ? (vars[index] ?? vars[String(index)])
        : undefined;
    return value === undefined || value === null ? '' : String(value);
  });
}

module.exports = {
  SEMANTIC_MESSAGES,
  MESSAGES,
  getMessageIdForText,
  getMessage,
  formatMessage
};
