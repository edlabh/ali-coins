'use strict';

const fs = require('fs');

/**
 * Harness determinístico de Playwright para testes de integração.
 *
 * Não abre Chromium nem acessa a rede: páginas, contextos e browsers falsos imitam
 * apenas a superfície usada pelo projeto (`goto`, `$`, `$$`, `innerText`, `evaluate`,
 * `waitForSelector`, `waitForTimeout`, eventos e `close`). As fixtures são HTML reais
 * convertidos para texto, para exercitar os mesmos parsers usados em produção.
 *
 * Esperas são determinísticas: `waitForTimeout` apenas registra a chamada (nunca dorme),
 * então a suíte não depende de relógio nem de `sleep`. Os fixtures de data usam o fuso
 * `America/Los_Angeles` no momento da criação, como o parser de produção; para eliminar
 * a dependência da data real, use `freezeTime` e restaure o relógio no `finally`.
 */

const { SELECTORS } = require('../../libs/selectors');

/**
 * Congela o relógio global (`new Date()` e `Date.now()`) no instante informado.
 *
 * Use em cenários que dependem da data de hoje (extrato/calendário) para que a suíte
 * não mude de comportamento perto da meia-noite no fuso do AliExpress. O retorno
 * restaura o relógio real e deve ser chamado em `finally`.
 *
 * @param {string|number|Date} [now='2026-10-30T12:00:00.000Z']
 * @returns {() => void}
 */
function freezeTime(now = '2026-10-30T12:00:00.000Z') {
  const RealDate = global.Date;
  const fixed = now instanceof RealDate ? now.getTime() : new RealDate(now).getTime();
  if (Number.isNaN(fixed)) {
    throw new TypeError(`Data inválida para freezeTime: ${String(now)}`);
  }

  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixed] : args));
    }

    static now() {
      return fixed;
    }
  }

  global.Date = FrozenDate;
  return () => {
    global.Date = RealDate;
  };
}

/**
 * Cria um coletor de chamadas para asserções sobre a interação com a página.
 * @returns {{calls: Array<{name: string, args: unknown[]}>, record: Function, count: Function, find: Function, clear: Function}}
 */
function createCallLog() {
  const calls = [];
  return {
    calls,
    record(name, args = []) {
      calls.push({ name, args });
    },
    count(name) {
      return calls.filter((call) => call.name === name).length;
    },
    find(name) {
      return calls.filter((call) => call.name === name);
    },
    clear() {
      calls.length = 0;
    }
  };
}

/**
 * Converte HTML simples em texto com quebras de linha, suficiente para os parsers de
 * `innerText` do projeto. Não é um parser DOM completo e não executa scripts.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|section|header|footer|tr|td|button|a|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Cria um elemento falso com click/evaluate/visibilidade.
 * @param {{text?: string, visible?: boolean, onClick?: Function}} [options={}]
 * @returns {object}
 */
function createFakeElement({ text = '', visible = true, onClick = null } = {}) {
  let clicks = 0;
  const element = {
    _text: text,
    _visible: visible,
    get clicks() {
      return clicks;
    },
    click: async () => {
      clicks += 1;
      if (typeof onClick === 'function') await onClick();
    },
    evaluate: async (fn) => {
      if (typeof fn === 'function') {
        try {
          return fn({ click: () => {}, textContent: text });
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    isVisible: async () => visible,
    textContent: async () => text,
    innerText: async () => text,
    fill: async () => {},
    press: async () => {}
  };
  return element;
}

/**
 * Cria uma página falsa. `resolveElement` recebe o seletor e decide qual elemento
 * (ou `null`) a página “encontra”.
 * @param {object} [options={}]
 * @returns {object}
 */
function createFakePage(options = {}) {
  const log = createCallLog();
  const listeners = new Map();
  const html = options.html || '';
  let bodyText = options.bodyText !== undefined ? options.bodyText : htmlToText(html);
  let currentUrl = options.url || 'about:blank';
  let closed = false;
  let context = options.context || null;

  const resolveElement = (selector, callOptions = {}) => {
    if (typeof options.resolveElement === 'function') {
      return options.resolveElement(selector, callOptions) || null;
    }
    return null;
  };

  const page = {
    _log: log,
    _html: html,
    get calls() {
      return log.calls;
    },
    get bodyText() {
      return bodyText;
    },
    setBodyText(value) {
      bodyText = String(value || '');
    },
    setContext(value) {
      context = value;
    },
    url: () => currentUrl,
    goto: async (target, gotoOptions) => {
      log.record('goto', [target, gotoOptions]);
      currentUrl = target;
      return { status: () => 200, url: () => target };
    },
    waitForSelector: async (selector, selectorOptions = {}) => {
      log.record('waitForSelector', [selector, selectorOptions]);
      const element = resolveElement(selector, selectorOptions);
      if (element && selectorOptions.state === 'visible' && element._visible === false) {
        return null;
      }
      return element;
    },
    $: async (selector) => {
      log.record('$', [selector]);
      return resolveElement(selector);
    },
    $$: async (selector) => {
      log.record('$$', [selector]);
      if (typeof options.resolveElements === 'function') {
        return options.resolveElements(selector) || [];
      }
      return [];
    },
    $eval: async (selector, fn) => {
      log.record('$eval', [selector]);
      if (typeof options.evalResult === 'function') {
        return options.evalResult(selector, fn);
      }
      if (options.evalResult !== undefined) return options.evalResult;
      const element = resolveElement(selector);
      return element ? element._text : '';
    },
    innerText: async (selector) => {
      log.record('innerText', [selector]);
      return bodyText;
    },
    evaluate: async (fn, arg) => {
      log.record('evaluate', [arg]);
      if (typeof options.evaluateResult === 'function') {
        return options.evaluateResult(fn, arg);
      }
      if (options.evaluateResult !== undefined) return options.evaluateResult;
      return undefined;
    },
    waitForLoadState: async (...args) => {
      log.record('waitForLoadState', args);
    },
    waitForTimeout: async (ms) => {
      // Determinístico de propósito: não dorme de verdade.
      log.record('waitForTimeout', [ms]);
    },
    on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    off: (event, handler) => {
      if (listeners.has(event)) listeners.get(event).delete(handler);
    },
    emit: (event, payload) => {
      for (const handler of listeners.get(event) || []) {
        try {
          handler(payload);
        } catch {
          // Consumidores reais também ignoram erros de listener.
        }
      }
    },
    context: () => context,
    close: async () => {
      if (closed) return;
      closed = true;
      log.record('close');
    },
    isClosed: () => closed,
    screenshot: async (screenshotOptions = {}) => {
      log.record('screenshot', [screenshotOptions]);
      const data = Buffer.from('fake-screenshot');
      // Espelha o Playwright real: com `path`, grava o arquivo no destino informado.
      // Isso permite testar diagnóstico/isolamento sem Chromium.
      if (screenshotOptions && screenshotOptions.path) {
        await fs.promises.writeFile(screenshotOptions.path, data, { mode: 0o600 });
      }
      return data;
    },
    setContent: async (value) => {
      bodyText = htmlToText(value);
      log.record('setContent');
    },
    title: async () => '',
    setViewportSize: async () => {}
  };

  return page;
}

/**
 * Cria um contexto falso com suporte a popup (`waitForEvent('page')`).
 * @param {{page?: object, pages?: object[], autoClosePages?: boolean}} [options={}]
 * @returns {object}
 */
function createFakeContext(options = {}) {
  const log = createCallLog();
  const pages = options.pages ? [...options.pages] : [];
  if (options.page && !pages.includes(options.page)) pages.push(options.page);
  const autoClosePages = options.autoClosePages !== false;
  let closed = false;
  let popupResolved = false;
  let resolvePopup = null;
  const popupPromise = new Promise((resolve) => {
    resolvePopup = resolve;
  });

  const context = {
    _log: log,
    get calls() {
      return log.calls;
    },
    newPage: async () => {
      log.record('newPage');
      if (pages.length > 0) return pages[0];
      const page = createFakePage({ context });
      pages.push(page);
      return page;
    },
    waitForEvent: async (event, waitOptions) => {
      log.record('waitForEvent', [event, waitOptions]);
      if (event === 'page') return popupPromise;
      throw new Error(`Evento não suportado no harness: ${event}`);
    },
    /**
     * Resolve o `waitForEvent('page')` pendente com o popup informado (ou `null`).
     * @param {object|null} popup
     */
    openPopup: (popup) => {
      if (popupResolved) return;
      popupResolved = true;
      if (popup && !pages.includes(popup)) pages.push(popup);
      resolvePopup(popup || null);
    },
    route: async (pattern) => {
      log.record('route', [pattern]);
    },
    tracing: {
      start: async (tracingOptions) => log.record('tracing.start', [tracingOptions]),
      stop: async () => log.record('tracing.stop')
    },
    close: async () => {
      if (closed) return;
      closed = true;
      log.record('close');
      if (autoClosePages) {
        for (const page of pages) {
          if (page && typeof page.close === 'function') await page.close().catch(() => {});
        }
      }
    },
    isClosed: () => closed,
    pages: () => [...pages],
    setDefaultTimeout: () => {},
    setDefaultNavigationTimeout: () => {}
  };
  return context;
}

/**
 * Cria um browser falso que devolve o contexto informado.
 * @param {{context?: object}} [options={}]
 * @returns {object}
 */
function createFakeBrowser(options = {}) {
  const log = createCallLog();
  let context = options.context || null;

  const browser = {
    _log: log,
    get calls() {
      return log.calls;
    },
    newContext: async (contextOptions) => {
      log.record('newContext', [contextOptions]);
      if (!context) context = createFakeContext();
      return context;
    },
    newPage: async () => {
      if (!context) context = createFakeContext();
      return context.newPage();
    },
    close: async () => {
      log.record('close');
      if (context && typeof context.close === 'function') {
        await context.close().catch(() => {});
      }
    },
    isConnected: () => true,
    context: () => context
  };
  return browser;
}

function todayPacificDate() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Los_Angeles' });
}

/**
 * HTML da portaria de login exibida pelo coin-index quando a sessão expirou.
 * @returns {string}
 */
function loginGateHtml() {
  return '<!doctype html><html><body><h1>COINS</h1><button>Log in</button></body></html>';
}

/**
 * HTML de uma central de moedas autenticada (link de login no rodapé + saldo).
 * @param {{balance?: string}} [options={}]
 * @returns {string}
 */
function authenticatedCoinHtml({ balance = '5,245' } = {}) {
  return [
    '<!doctype html><html><body>',
    '<header>COINS</header>',
    `<div>My coins</div><div>${balance}</div>`,
    '<footer><a>Log in</a></footer>',
    '</body></html>'
  ].join('');
}

/**
 * HTML da central de moedas desktop com extrato de hoje.
 * @param {{balance?: string, bonus?: number, streak?: number, loginPrompt?: boolean}} [options={}]
 * @returns {string}
 */
function coinCenterHtml({ balance = '5,245', bonus = 40, streak = 254, loginPrompt = false } = {}) {
  if (loginPrompt) {
    return [
      '<!doctype html><html><body>',
      '<h1>Sign in with email code</h1>',
      '<input type="password" />',
      '<button>Sign in</button>',
      '</body></html>'
    ].join('');
  }
  return [
    '<!doctype html><html><body>',
    `<div>My coins</div><div>${balance}</div>`,
    `<div>${todayPacificDate()} PT</div>`,
    '<div>App daily check-in</div>',
    `<div>+${bonus}</div>`,
    `<div>${streak} dias seguidos</div>`,
    '</body></html>'
  ].join('');
}

/**
 * HTML do calendário "Daily coins" com "Today" alinhado ao dia detectado.
 * @param {{todayDay?: number, maxDay?: number}} [options={}]
 * @returns {string}
 */
function calendarHtml({ todayDay = 254, maxDay = 260 } = {}) {
  const start = Math.max(1, todayDay - 3);
  const lines = ['<div>Daily coins</div>'];
  for (let day = start; day < todayDay; day += 1) lines.push(`<div>Day ${day}</div>`);
  lines.push('<div>Today</div>', '<div>Tomorrow</div>');
  for (let day = todayDay + 1; day <= maxDay; day += 1) lines.push(`<div>Day ${day}</div>`);
  return `<!doctype html><html><body>${lines.join('')}</body></html>`;
}

/**
 * HTML da página mobile com o atalho de busca embutido.
 * @param {{keyword?: string}} [options={}]
 * @returns {string}
 */
function searchPageHtml({ keyword = 'Rx 580 8gb' } = {}) {
  return [
    '<!doctype html><html><body>',
    '<div>Earn more coins</div>',
    `<div class="aecoin-searchEntrance-x">${keyword}</div>`,
    '<button class="aecoin-searchNow-x">Search now</button>',
    '</body></html>'
  ].join('');
}

/**
 * Página da central de moedas para leitura desktop, com resolução de elementos.
 * @param {object} [options={}]
 * @returns {object}
 */
function createCoinCenterPage(options = {}) {
  const html = coinCenterHtml(options);
  const page = createFakePage({
    url: 'https://www.aliexpress.com/p/coin-pc-index/mycoin.html',
    html,
    resolveElement: (selector) => {
      if (String(selector).includes('mycoinCheckin')) {
        return createFakeElement({ text: 'App daily check-in' });
      }
      if (options.loginPrompt && String(selector).includes('input[type="password"]')) {
        return createFakeElement({ text: 'password' });
      }
      return null;
    }
  });
  return page;
}

/**
 * Página mobile com o calendário real (retornado por `evaluate`).
 * @param {object} [options={}]
 * @returns {object}
 */
function createCalendarPage(options = {}) {
  const html = calendarHtml(options);
  return createFakePage({
    url: 'https://m.aliexpress.com/p/coin-index/index.html',
    html,
    evaluateResult: htmlToText(html)
  });
}

/**
 * Página da portaria de login (DOM com botão e sem saldo).
 * @returns {object}
 */
function createLoginGatePage() {
  const html = loginGateHtml();
  return createFakePage({
    url: 'https://m.aliexpress.com/p/coin-index/index.html',
    html,
    resolveElement: (selector) => {
      if (/Log in|Entrar|Sign in/i.test(String(selector))) {
        return createFakeElement({ text: 'Log in' });
      }
      return null;
    }
  });
}

/**
 * Página autenticada com link de login no rodapé e saldo visível.
 * @param {{balance?: string}} [options={}]
 * @returns {object}
 */
function createAuthenticatedCoinPage(options = {}) {
  const html = authenticatedCoinHtml(options);
  return createFakePage({
    url: 'https://m.aliexpress.com/p/coin-index/index.html',
    html,
    resolveElement: (selector) => {
      if (/Log in|Entrar|Sign in|My coins|Minhas moedas/i.test(String(selector))) {
        return createFakeElement({ text: 'Log in' });
      }
      return null;
    }
  });
}

/**
 * Cria um cenário de busca embutida: página principal + popup + contexto/browser.
 * @param {{popupUrl?: string, keyword?: string, openPopup?: boolean}} [options={}]
 * @returns {{page: object, popup: object, context: object, browser: object}}
 */
function createSearchScenario(options = {}) {
  const popupUrl =
    options.popupUrl || 'https://m.aliexpress.com/p/coin-search/result.html?search_query=rx';
  const keyword = options.keyword || 'Rx 580 8gb';
  const shouldOpenPopup = options.openPopup !== false;
  const popup = createFakePage({
    url: popupUrl,
    html: '<div>Search results</div>'
  });
  let context = null;
  const searchNow = createFakeElement({
    text: 'Search now',
    onClick: () => {
      // `null` resolve o `waitForEvent('page')` como "nenhuma aba abriu", sem esperar
      // o timeout real de 8 s do Playwright.
      if (context) context.openPopup(shouldOpenPopup ? popup : null);
    }
  });
  const page = createFakePage({
    url: 'https://m.aliexpress.com/p/coin-index/index.html',
    html: searchPageHtml({ keyword }),
    evalResult: keyword,
    resolveElement: (selector) => {
      if (String(selector).includes('aecoin-searchNow')) return searchNow;
      return null;
    }
  });
  context = createFakeContext({ page });
  page.setContext(context);
  const browser = createFakeBrowser({ context });
  return { page, popup, context, browser };
}

/**
 * Cria um browser falso para uma página já construída.
 * @param {object} page
 * @returns {{browser: object, context: object, page: object}}
 */
function createBrowserForPage(page) {
  const context = createFakeContext({ page });
  page.setContext(context);
  const browser = createFakeBrowser({ context });
  return { browser, context, page };
}

/**
 * Logger de captura para asserções de mensagens sem ruído no stdout dos testes.
 * @returns {{messages: string[], info: Function, warn: Function, error: Function, debug: Function}}
 */
function createCaptureLogger() {
  const messages = [];
  const push =
    (level) =>
    (...args) => {
      messages.push(
        `[${level}] ${args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
          .join(' ')}`
      );
    };
  return {
    messages,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    debug: push('debug')
  };
}

module.exports = {
  SELECTORS,
  freezeTime,
  createCallLog,
  htmlToText,
  createFakeElement,
  createFakePage,
  createFakeContext,
  createFakeBrowser,
  createBrowserForPage,
  createCaptureLogger,
  todayPacificDate,
  FIXTURES: {
    loginGateHtml,
    authenticatedCoinHtml,
    coinCenterHtml,
    calendarHtml,
    searchPageHtml
  },
  createCoinCenterPage,
  createCalendarPage,
  createLoginGatePage,
  createAuthenticatedCoinPage,
  createSearchScenario
};
