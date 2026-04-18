/**
 * Backup Service — save and retrieve per-user backup data
 *
 * FIX: Updated require paths to match flat file structure (no services/ subfolder).
 */

const db = require('./database');
const config = require('./config');

/**
 * Save (or overwrite) a backup for a Telegram user.
 */
async function saveBackup(telegramId, data, filename = 'backup.json') {
  telegramId = String(telegramId);

  try {
    const serialised = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(serialised, 'utf-8');

    if (sizeBytes > config.BACKUP.MAX_SIZE_BYTES) {
      return {
        success: false,
        error: `Backup too large (${Math.round(sizeBytes / 1024)}KB). Maximum is ${config.BACKUP.MAX_SIZE_BYTES / 1024}KB.`,
      };
    }

    const existing = db.getBackup(telegramId);
    const version = existing ? (existing.version || 1) + 1 : 1;

    const record = {
      data,
      filename: sanitizeFilename(filename),
      savedAt: new Date().toISOString(),
      version,
      sizeBytes,
    };

    db.setBackup(telegramId, record);

    return { success: true, size: sizeBytes, version };
  } catch (err) {
    console.error('saveBackup error:', err);
    return { success: false, error: 'Internal error while saving backup.' };
  }
}

/**
 * Retrieve the latest backup for a Telegram user.
 */
async function getBackup(telegramId) {
  telegramId = String(telegramId);
  const backup = db.getBackup(telegramId);

  if (!backup) {
    return { success: false, reason: 'not_found' };
  }

  return { success: true, backup };
}

/**
 * Delete a user's backup (e.g. on unlink).
 */
async function deleteBackup(telegramId) {
  telegramId = String(telegramId);
  db.deleteBackup(telegramId);
  return { success: true };
}

function sanitizeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 128);
}

module.exports = { saveBackup, getBackup, deleteBackup };
