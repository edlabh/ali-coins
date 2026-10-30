'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const espree = require('espree');

const i18n = require('../libs/i18n');
const catalog = require('../libs/i18n/log-catalog');
const messages = require('../libs/i18n/messages');

const ROOT = path.join(__dirname, '..');

test.afterEach(() => {
  i18n.setLanguage('pt-BR');
  i18n.resetI18nTelemetry();
});

function countPlaceholders(text) {
  return (String(text).match(/\{\{\d+\}\}/g) || []).length;
}

test('i18n IDs - mensagens semânticas têm PT/EN e placeholders equivalentes', () => {
  const semanticEntries = Object.entries(messages.SEMANTIC_MESSAGES);
  assert.ok(semanticEntries.length >= 30, 'catálogo semântico deve cobrir as frentes migradas');

  for (const [id, pt] of semanticEntries) {
    const entry = messages.getMessage(id);
    assert.ok(entry, `ID ausente: ${id}`);
    assert.strictEqual(entry.pt, pt);
    assert.ok(entry.en && entry.en.trim(), `ID "${id}" sem tradução EN`);
    assert.strictEqual(
      countPlaceholders(entry.pt),
      countPlaceholders(entry.en),
      `placeholders divergentes em "${id}"`
    );
    assert.strictEqual(messages.getMessageIdForText(pt), id, `texto não resolve para "${id}"`);
    assert.strictEqual(messages.getMessageIdForText(`  ${pt}  `), id, `trim não resolve "${id}"`);
  }
});

test('i18n IDs - toda mensagem do catálogo legado tem ID registrado', () => {
  for (const pt of Object.keys(catalog.exact)) {
    assert.ok(messages.getMessageIdForText(pt), `mensagem exata sem ID: ${pt}`);
  }
  for (const entry of catalog.templates) {
    assert.ok(messages.getMessageIdForText(entry.pt), `template sem ID: ${entry.pt}`);
  }

  assert.strictEqual(
    messages.getMessageIdForText('Sessão válida (somente leitura).'),
    'session.check.valid'
  );
  assert.match(
    messages.getMessageIdForText('Acessando central de moedas...'),
    /^legacy\.[0-9a-f]{12}$/,
    'mensagens ainda não migradas usam ID legado determinístico'
  );
});

test('i18n IDs - translateId respeita PT/EN, interpola e registra telemetria', () => {
  i18n.resetI18nTelemetry();
  i18n.setLanguage('pt-BR');
  assert.strictEqual(i18n.translateId('session.check.valid'), 'Sessão válida (somente leitura).');

  i18n.setLanguage('en');
  assert.strictEqual(i18n.translateId('session.check.valid'), 'Valid session (read-only).');
  assert.match(
    i18n.translateId('session.check.summary', ['OK', 'us***@example.com', 'balance=10']),
    /^\[OK\] us\*\*\*@example\.com — balance=10$/
  );
  assert.strictEqual(
    i18n.translateId('checkin.streak.calendar_lower').includes('AliExpress'),
    true
  );

  const telemetry = i18n.getI18nTelemetry();
  assert.strictEqual(telemetry.idUsage['session.check.valid'], 2);
  assert.strictEqual(telemetry.idUsage['session.check.summary'], 1);
  assert.strictEqual(telemetry.unknownIds.length, 0);

  assert.strictEqual(i18n.translateId('nao.existe'), null);
  assert.deepStrictEqual(i18n.getI18nTelemetry().unknownIds, ['nao.existe']);
});

test('i18n IDs - uso por texto legado é contado para orientar a migração', () => {
  i18n.setLanguage('en');
  i18n.resetI18nTelemetry();

  assert.strictEqual(
    i18n.translateMessage('Sessão válida (somente leitura).'),
    'Valid session (read-only).'
  );
  const telemetry = i18n.getI18nTelemetry();
  assert.strictEqual(telemetry.legacyUsage['session.check.valid'], 1);
  assert.deepStrictEqual(telemetry.idUsage, {});
});

test('i18n IDs - logger traduz msgId no processo real', () => {
  const script = `
    process.env.APP_LANGUAGE = 'en';
    const logger = require('./logger');
    logger.info({ msgId: 'session.check.valid' }, 'Sessão válida (somente leitura).');
    logger.info(
      { msgId: 'session.check.summary', msgParams: ['OK', 'us***@example.com', 'balance=10'] },
      '[OK] us***@example.com — saldo=10'
    );
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, APP_LANGUAGE: 'en', LOG_LEVEL: 'info' }
  });

  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /Valid session \(read-only\)\./);
  assert.match(result.stdout, /\[OK\] us\*\*\*@example\.com — balance=10/);
  assert.doesNotMatch(result.stdout, /Sessão válida \(somente leitura\)/);
});

/* ------------------------------------------------------------------------------------------------
 * Scanner AST: toda mensagem de logger precisa resolver para um ID registrado e todo msgId
 * precisa existir no catálogo. Arquivos já migrados não podem voltar a usar texto sem ID.
 * ---------------------------------------------------------------------------------------------- */

function walkFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'scratch', 'extracted'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
}

function walkNodes(node, cb) {
  if (!node || typeof node !== 'object') return;
  cb(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((item) => walkNodes(item, cb));
    else if (value && typeof value === 'object' && value.type) walkNodes(value, cb);
  }
}

function flatten(node, state) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral') {
    let text = '';
    const base = state.next;
    for (let i = 0; i < node.quasis.length; i++) {
      text += node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
      if (i < node.expressions.length) {
        text += `{{${base + i}}}`;
        state.next += 1;
      }
    }
    return [text];
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = flatten(node.left, state);
    const right = flatten(node.right, state);
    if (!left || !right) return null;
    return left.flatMap((l) => right.map((r) => l + r));
  }
  if (node.type === 'ConditionalExpression') {
    return [...(flatten(node.consequent, state) || []), ...(flatten(node.alternate, state) || [])];
  }
  return null;
}

function scanLoggerCalls() {
  const files = [];
  walkFiles(ROOT, files);
  const calls = [];

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = espree.parse(`(function(){\n${code}\n})`, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        loc: true
      });
    } catch {
      continue;
    }
    walkNodes(ast, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = node.callee;
      if (!callee || callee.type !== 'MemberExpression') return;
      if (callee.object.type !== 'Identifier' || callee.object.name !== 'logger') return;
      if (callee.property.type !== 'Identifier') return;
      if (!['info', 'warn', 'error', 'debug', 'fatal', 'trace'].includes(callee.property.name)) {
        return;
      }
      if (!node.arguments.length) return;

      let msgId = null;
      const first = node.arguments[0];
      if (first.type === 'ObjectExpression') {
        for (const prop of first.properties) {
          if (
            prop.type === 'Property' &&
            prop.key.type === 'Identifier' &&
            prop.key.name === 'msgId' &&
            prop.value.type === 'Literal'
          ) {
            msgId = prop.value.value;
          }
        }
      }

      let texts = [];
      for (let i = node.arguments.length - 1; i >= 0; i--) {
        const flattened = flatten(node.arguments[i], { next: 0 });
        if (flattened && flattened.length) {
          texts = flattened;
          break;
        }
      }
      if (!texts.length && !msgId) return;
      calls.push({
        file: path.relative(ROOT, file),
        line: node.loc.start.line,
        level: callee.property.name,
        msgId,
        texts
      });
    });
  }
  return calls;
}

test('i18n IDs - toda chamada de logger usa mensagem registrada e msgId existente', () => {
  const calls = scanLoggerCalls();
  assert.ok(calls.length > 100, `scanner deveria encontrar chamadas de logger (${calls.length})`);

  const unknownIds = [];
  const unknownMessages = [];
  for (const call of calls) {
    if (call.msgId && !messages.getMessage(call.msgId)) {
      unknownIds.push(`${call.file}:${call.line} (${call.msgId})`);
    }
    for (const text of call.texts) {
      if (!messages.getMessageIdForText(text)) {
        unknownMessages.push(`${call.file}:${call.line} (${text.slice(0, 80)})`);
      }
    }
  }

  assert.deepStrictEqual(unknownIds, [], `msgId não registrado: ${unknownIds.join(' | ')}`);
  assert.deepStrictEqual(
    unknownMessages,
    [],
    `mensagem de logger sem ID registrado: ${unknownMessages.join(' | ')}`
  );
});

test('i18n IDs - arquivos migrados usam msgId explícito e IDs semânticos', () => {
  const calls = scanLoggerCalls();
  const strictFiles = new Set(['libs/session-check.js', 'libs/ui/login.js']);

  for (const call of calls) {
    if (strictFiles.has(call.file)) {
      assert.ok(call.msgId, `${call.file}:${call.line} deveria usar msgId explícito`);
    }
  }

  const streakCalls = calls.filter(
    (call) =>
      call.file === 'libs/runner/single.js' &&
      call.texts.some((text) => /streak|sequência|extrato|check-in não confirmado/i.test(text))
  );
  assert.ok(streakCalls.length >= 6, 'deve haver chamadas de streak para validar');
  for (const call of streakCalls) {
    const id =
      call.msgId ||
      call.texts.map((text) => messages.getMessageIdForText(text)).find(Boolean) ||
      null;
    assert.ok(id, `${call.file}:${call.line} sem ID`);
    assert.ok(!id.startsWith('legacy.'), `${call.file}:${call.line} ainda usa ID legado (${id})`);
  }

  const importCalls = calls.filter((call) => call.file === 'import_session.js');
  const importIds = importCalls
    .map((call) => call.msgId)
    .filter((id) => id && id.startsWith('import.'));
  assert.ok(importIds.length >= 10, 'mensagens principais de importação devem ter ID');

  // Nenhum ID semântico órfão: todo ID declarado precisa aparecer em uma chamada real.
  const usedSemanticIds = new Set();
  for (const call of calls) {
    if (call.msgId) usedSemanticIds.add(call.msgId);
    for (const text of call.texts) {
      const id = messages.getMessageIdForText(text);
      if (id && !id.startsWith('legacy.')) usedSemanticIds.add(id);
    }
  }
  const orphans = Object.keys(messages.SEMANTIC_MESSAGES).filter((id) => !usedSemanticIds.has(id));
  assert.deepStrictEqual(orphans, [], `IDs semânticos sem uso no código: ${orphans.join(', ')}`);
});
