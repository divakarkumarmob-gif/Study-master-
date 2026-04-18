/**
 * Database Layer — persistent JSON file storage
 * Schema:
 *   otps:    { [telegramId]: { otp, expiresAt, attempts, createdAt } }
 *   backups: { [telegramId]: { data, filename, savedAt, version } }
 *   links:   { [telegramId]: { appUserId, linkedAt } }
 *
 * FIXES:
 *  - mkdirSync wrapped in try/catch to avoid crash if dir already exists
 *    on some Railway filesystem configurations.
 *  - save() wrapped in try/catch so a single write failure doesn't crash the bot.
 *  - Malformed DB file now always recovers cleanly.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DB_PATH = path.resolve(config.DB_PATH);
const DB_DIR = path.dirname(DB_PATH);

let _db = { otps: {}, backups: {}, links: {} };

function init() {
  // FIX: wrapped in try/catch — Railway ephemeral FS can behave unexpectedly
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('⚠️  Could not create DB directory:', err.message);
  }

  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      // Ensure all collections exist (backwards compat)
      _db = {
        otps:    parsed.otps    || {},
        backups: parsed.backups || {},
        links:   parsed.links   || {},
      };
      console.log(`📂 Database loaded from ${DB_PATH}`);
    } catch (err) {
      console.warn('⚠️  Could not parse DB — starting fresh:', err.message);
      _db = { otps: {}, backups: {}, links: {} };
      save(); // write a clean file immediately
    }
  } else {
    save();
    console.log(`📂 New database created at ${DB_PATH}`);
  }
}

// FIX: save() no longer throws — a write failure logs a warning instead of
//      crashing the entire process.
function save() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(_db, null, 2), 'utf-8');
  } catch (err) {
    console.error('⚠️  DB write failed (data kept in memory):', err.message);
  }
}

// ─── OTP ──────────────────────────────────────────────────────────────────────

function setOTP(telegramId, record) {
  _db.otps[telegramId] = record;
  save();
}

function getOTP(telegramId) {
  return _db.otps[telegramId] || null;
}

function deleteOTP(telegramId) {
  delete _db.otps[telegramId];
  save();
}

// ─── BACKUPS ──────────────────────────────────────────────────────────────────

function setBackup(telegramId, record) {
  _db.backups[telegramId] = record;
  save();
}

function getBackup(telegramId) {
  return _db.backups[telegramId] || null;
}

function deleteBackup(telegramId) {
  delete _db.backups[telegramId];
  save();
}

// ─── LINKS (telegramId ↔ appUserId) ──────────────────────────────────────────

function setLink(telegramId, appUserId) {
  _db.links[telegramId] = { appUserId, linkedAt: new Date().toISOString() };
  save();
}

function getLink(telegramId) {
  return _db.links[telegramId] || null;
}

function getLinkByAppId(appUserId) {
  return Object.entries(_db.links).find(([, v]) => v.appUserId === appUserId) || null;
}

function deleteLink(telegramId) {
  delete _db.links[telegramId];
  save();
}

module.exports = {
  init, save,
  setOTP, getOTP, deleteOTP,
  setBackup, getBackup, deleteBackup,
  setLink, getLink, getLinkByAppId, deleteLink,
};
