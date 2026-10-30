'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldAttemptLogin,
  isLoginGateText,
  isLoginPromptText
} = require('../libs/checkin/login-gate');
const {
  shouldConfirmCheckinByLedger,
  shouldConfirmStreakByStatement,
  shouldReuseEarlyDesktop
} = require('../libs/checkin/streak');
const { isSessionDataMissing, buildCheckinResult } = require('../libs/checkin/result');
const collect = require('../collect');

test('libs/checkin/login-gate.js - decide re-login sem confundir rodapé autenticado', () => {
  assert.strictEqual(shouldAttemptLogin({ hasValidSession: false }), true);
  assert.strictEqual(shouldAttemptLogin({ hasValidSession: true, passwordVisible: true }), true);
  assert.strictEqual(
    shouldAttemptLogin({ hasValidSession: true, gateVisible: true }),
    true,
    'portaria DOM deve forçar tentativa de login'
  );
  assert.strictEqual(
    shouldAttemptLogin({ hasValidSession: true, bodyText: 'COINS\nLog in' }),
    true,
    'texto isolado de portaria sem dígitos deve forçar login'
  );
  assert.strictEqual(
    shouldAttemptLogin({
      hasValidSession: true,
      loginUrl: true,
      usernameVisible: true
    }),
    true
  );
  assert.strictEqual(
    shouldAttemptLogin({
      hasValidSession: true,
      loginUrl: true,
      bodyText: 'Sign in'
    }),
    true
  );

  // Página autenticada: rodapé tem "Log in", mas o saldo (dígitos) está presente.
  assert.strictEqual(
    shouldAttemptLogin({ hasValidSession: true, bodyText: 'My coins\n5,245\nLog in' }),
    false
  );
  assert.strictEqual(shouldAttemptLogin({ hasValidSession: true }), false);
  assert.strictEqual(isLoginGateText('COINS\nEntrar'), true);
  assert.strictEqual(isLoginGateText('My coins\n5,245\nLog in'), false);
  assert.strictEqual(isLoginPromptText('Sign in with email code'), true);
});

test('libs/checkin/streak.js - confirmações e reúso preservam as regras da 2.4.0', () => {
  assert.strictEqual(
    shouldConfirmCheckinByLedger({
      justCollected: false,
      alreadyCollected: false,
      hasBonusFromLedger: true
    }),
    true
  );
  assert.strictEqual(
    shouldConfirmCheckinByLedger({ justCollected: true, hasBonusFromLedger: true }),
    false
  );
  assert.strictEqual(
    shouldConfirmCheckinByLedger({ alreadyCollected: true, hasBonusFromLedger: true }),
    false
  );
  assert.strictEqual(shouldConfirmCheckinByLedger({}), false);

  assert.strictEqual(
    shouldConfirmStreakByStatement({ detectedStreak: 1, previousStreakDays: 221 }),
    true
  );
  assert.strictEqual(
    shouldConfirmStreakByStatement({
      detectedStreak: '1 dia',
      previousStreakDays: 221,
      statementStreak: null
    }),
    true
  );
  assert.strictEqual(
    shouldConfirmStreakByStatement({
      detectedStreak: 1,
      previousStreakDays: 221,
      statementStreak: 222
    }),
    false
  );
  assert.strictEqual(
    shouldConfirmStreakByStatement({
      detectedStreak: 1,
      previousStreakDays: 221,
      alreadyCollected: true
    }),
    false
  );
  assert.strictEqual(shouldConfirmStreakByStatement({}), false);

  assert.strictEqual(shouldReuseEarlyDesktop({ earlyDesktop: { totalBalance: '2531' } }), true);
  assert.strictEqual(
    shouldReuseEarlyDesktop({ justCollected: true, earlyDesktop: { totalBalance: '2531' } }),
    false
  );
  assert.strictEqual(shouldReuseEarlyDesktop({ earlyDesktop: { totalBalance: 'N/D' } }), false);
  assert.strictEqual(shouldReuseEarlyDesktop({ earlyDesktop: {} }), false);
  assert.strictEqual(shouldReuseEarlyDesktop({}), false);
});

test('libs/checkin/result.js - contrato do checkinResult e guarda de sessão', () => {
  assert.strictEqual(isSessionDataMissing({ totalBalance: 'N/D', streakDays: 38 }), true);
  assert.strictEqual(isSessionDataMissing({ totalBalance: null }), true);
  assert.strictEqual(isSessionDataMissing({}), true);
  assert.strictEqual(isSessionDataMissing({ totalBalance: '3028' }), false);
  assert.strictEqual(isSessionDataMissing({ totalBalance: 0 }), false);

  const startTime = new Date('2026-10-30T12:00:00.000Z');
  const endTime = new Date('2026-10-30T12:00:02.000Z');
  const sessionData = { cookies: [] };
  const result = buildCheckinResult({
    userEmail: 'user@example.com',
    alreadyCollected: true,
    coinsGainedToday: '40',
    checkinCoinsFromLedger: true,
    statementStreakDays: 254,
    totalBalance: '5245',
    streakDays: 254,
    previousStreakDays: 254,
    longestStreakDays: 260,
    trustDetected: true,
    startTime,
    endTime,
    duration: '2s',
    sessionData,
    loginAttempted: true,
    reusedEarlyDesktop: true
  });

  assert.deepStrictEqual(result, {
    userEmail: 'user@example.com',
    alreadyCollected: true,
    coinsGainedToday: '40',
    checkinCoinsFromLedger: true,
    statementStreakDays: 254,
    totalBalance: '5245',
    streakDays: 254,
    previousStreakDays: 254,
    longestStreakDays: 260,
    trustDetected: true,
    startTime,
    endTime,
    duration: '2s',
    sessionData,
    loginAttempted: true,
    reusedEarlyDesktop: true
  });
});

test('collect.js - reexporta os helpers extraídos sem quebrar consumidores', () => {
  assert.strictEqual(collect.shouldAttemptLogin, shouldAttemptLogin);
  assert.strictEqual(collect.shouldConfirmCheckinByLedger, shouldConfirmCheckinByLedger);
  assert.strictEqual(collect.shouldConfirmStreakByStatement, shouldConfirmStreakByStatement);
  assert.strictEqual(collect.shouldReuseEarlyDesktop, shouldReuseEarlyDesktop);
  assert.strictEqual(collect.isSessionDataMissing, isSessionDataMissing);
});
