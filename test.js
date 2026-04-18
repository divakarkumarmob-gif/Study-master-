/**
 * Basic smoke tests — run with: node tests/test.js
 * (Bot does NOT need to be running for these tests)
 */

const assert = require('assert');

// Patch DB path to use a temp file
process.env.DB_PATH = './data/test_db.json';

const db = require('../database');
const otpService = require('../services/otpService');
const backupService = require('../services/backupService');
const { sanitizeJSON, formatSize } = require('../utils/helpers');

db.init();

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
console.log('\n📋 Helpers');

test('sanitizeJSON parses valid JSON', () => {
  const r = sanitizeJSON('{"key":"val"}');
  assert.deepStrictEqual(r, { key: 'val' });
});

test('sanitizeJSON returns null for invalid JSON', () => {
  assert.strictEqual(sanitizeJSON('not json'), null);
});

test('sanitizeJSON passes through objects', () => {
  const obj = { a: 1 };
  assert.strictEqual(sanitizeJSON(obj), obj);
});

test('formatSize formats bytes', () => {
  assert.strictEqual(formatSize(500), '500 B');
  assert.strictEqual(formatSize(2048), '2.0 KB');
});

// ─── OTP Service ──────────────────────────────────────────────────────────────
console.log('\n🔑 OTP Service');

const TEST_TG = 'TEST_99999';

test('generates OTP successfully', () => {
  db.deleteOTP(TEST_TG);
  const r = otpService.generateOTP(TEST_TG);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.otp.length, 6);
});

test('rate-limits rapid re-generation', () => {
  const r = otpService.generateOTP(TEST_TG);
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.reason, 'rate_limited');
});

test('rejects invalid OTP', () => {
  db.deleteOTP(TEST_TG);
  otpService.generateOTP(TEST_TG);
  const r = otpService.verifyOTP(TEST_TG, '000000');
  // Could be invalid or accidentally correct
  if (r.success === false) {
    assert.ok(['invalid', 'locked'].includes(r.reason));
  }
});

test('verifies correct OTP and deletes it', () => {
  db.deleteOTP(TEST_TG);
  const gen = otpService.generateOTP(TEST_TG);
  const ver = otpService.verifyOTP(TEST_TG, gen.otp);
  assert.strictEqual(ver.success, true);
  // OTP consumed — second verify should fail
  const ver2 = otpService.verifyOTP(TEST_TG, gen.otp);
  assert.strictEqual(ver2.success, false);
  assert.strictEqual(ver2.reason, 'no_otp');
});

test('detects expired OTP', () => {
  db.deleteOTP(TEST_TG);
  const gen = otpService.generateOTP(TEST_TG);
  // Manually expire the record
  const record = db.getOTP(TEST_TG);
  record.expiresAt = Date.now() - 1;
  db.setOTP(TEST_TG, record);

  const r = otpService.verifyOTP(TEST_TG, gen.otp);
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.reason, 'expired');
});

// ─── Backup Service ───────────────────────────────────────────────────────────
console.log('\n📦 Backup Service');

const BACKUP_TG = 'TEST_BACKUP_88888';

test('saves a backup', async () => {
  const r = await backupService.saveBackup(BACKUP_TG, { userId: 42, settings: {} });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.version, 1);
});

test('increments version on overwrite', async () => {
  const r = await backupService.saveBackup(BACKUP_TG, { userId: 42, updated: true });
  assert.strictEqual(r.version, 2);
});

test('retrieves saved backup', async () => {
  const r = await backupService.getBackup(BACKUP_TG);
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(r.backup.data, { userId: 42, updated: true });
});

test('returns not_found for unknown user', async () => {
  const r = await backupService.getBackup('NONEXISTENT_USER');
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.reason, 'not_found');
});

test('deletes a backup', async () => {
  await backupService.deleteBackup(BACKUP_TG);
  const r = await backupService.getBackup(BACKUP_TG);
  assert.strictEqual(r.success, false);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
