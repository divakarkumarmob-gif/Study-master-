/**
 * OTP Service — generate, validate, and expire one-time passwords
 *
 * FIX: Updated require paths to match flat file structure (no services/ subfolder).
 */

const crypto = require('crypto');
const db = require('./database');
const config = require('./config');

const { LENGTH, EXPIRY_MS, MAX_ATTEMPTS, COOLDOWN_MS, RATE_LIMIT_MS } = config.OTP;

/**
 * Generate a cryptographically random numeric OTP.
 * @returns {string} zero-padded N-digit string
 */
function createOTPCode() {
  const max = Math.pow(10, LENGTH);
  const raw = crypto.randomInt(0, max);
  return String(raw).padStart(LENGTH, '0');
}

/**
 * Issue a new OTP for a Telegram user.
 * Enforces rate-limiting so users can't spam new codes.
 */
function generateOTP(telegramId) {
  const existing = db.getOTP(telegramId);
  const now = Date.now();

  if (existing) {
    const age = now - existing.createdAt;

    // Still within rate-limit window?
    if (age < RATE_LIMIT_MS) {
      return {
        success: false,
        reason: 'rate_limited',
        waitSeconds: Math.ceil((RATE_LIMIT_MS - age) / 1000),
      };
    }

    // User is locked out after too many attempts
    if (existing.locked && now < existing.lockedUntil) {
      return {
        success: false,
        reason: 'locked',
        waitSeconds: Math.ceil((existing.lockedUntil - now) / 1000),
      };
    }
  }

  const otp = createOTPCode();
  const record = {
    otp,
    createdAt: now,
    expiresAt: now + EXPIRY_MS,
    attempts: 0,
    locked: false,
    lockedUntil: null,
  };

  db.setOTP(telegramId, record);

  return { success: true, otp, expiresAt: record.expiresAt };
}

/**
 * Verify an OTP submitted by the mobile app.
 * Returns { success, telegramId } or { success: false, reason }
 */
function verifyOTP(telegramId, submittedOTP) {
  telegramId = String(telegramId);
  const record = db.getOTP(telegramId);
  const now = Date.now();

  if (!record) {
    return { success: false, reason: 'no_otp', message: 'No OTP found. Generate one with /otp in the bot.' };
  }

  // Check lockout
  if (record.locked && now < record.lockedUntil) {
    const waitSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return { success: false, reason: 'locked', message: `Too many failed attempts. Try again in ${waitSeconds}s.` };
  }

  // Check expiry
  if (now > record.expiresAt) {
    db.deleteOTP(telegramId);
    return { success: false, reason: 'expired', message: 'OTP has expired. Use /otp to get a new one.' };
  }

  // Check code
  if (record.otp !== String(submittedOTP).trim()) {
    record.attempts += 1;

    if (record.attempts >= MAX_ATTEMPTS) {
      record.locked = true;
      record.lockedUntil = now + COOLDOWN_MS;
      db.setOTP(telegramId, record);
      return { success: false, reason: 'locked', message: `Too many attempts. Locked for ${COOLDOWN_MS / 1000}s.` };
    }

    db.setOTP(telegramId, record);
    const remaining = MAX_ATTEMPTS - record.attempts;
    return { success: false, reason: 'invalid', message: `Invalid OTP. ${remaining} attempt(s) remaining.` };
  }

  // ✅ Valid — consume the OTP immediately (one-time use)
  db.deleteOTP(telegramId);
  return { success: true, telegramId };
}

module.exports = { generateOTP, verifyOTP };
