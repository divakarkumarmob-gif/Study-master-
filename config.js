/**
 * Configuration — all environment-driven settings in one place
 *
 * FIX: Added BOT_TOKEN validation. If token is missing the process exits
 * immediately with a clear message instead of crashing later with a cryptic
 * Telegraf error.
 */

require('dotenv').config();

// ── Validate required env vars before anything else ──────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN || BOT_TOKEN.trim() === '' || BOT_TOKEN === 'your_telegram_bot_token_here') {
  console.error('❌ FATAL: BOT_TOKEN environment variable is missing or not set.');
  console.error('   Set it in your .env file or Railway environment variables.');
  process.exit(1);
}

module.exports = {
  BOT_TOKEN: BOT_TOKEN.trim(),

  // FIX: parseInt can return NaN — use fallback safely
  PORT: Number(process.env.PORT) || 3000,

  OTP: {
    LENGTH: 6,
    EXPIRY_MS: 2 * 60 * 1000,       // 2 minutes
    MAX_ATTEMPTS: 5,
    COOLDOWN_MS: 60 * 1000,          // 1 minute cooldown after max attempts
    RATE_LIMIT_MS: 30 * 1000,        // min gap between new OTP requests
  },

  BACKUP: {
    MAX_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
  },

  DB_PATH: process.env.DB_PATH || './data/db.json',
};
