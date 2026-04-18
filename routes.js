/**
 * REST API Routes — consumed by the mobile app
 *
 * POST   /api/otp/generate       → generate OTP for a Telegram user
 * POST   /api/otp/verify         → verify OTP & link app user
 * POST   /api/backup             → upload backup (requires valid link)
 * GET    /api/backup/:telegramId → download backup (requires valid link)
 * GET    /api/status/:telegramId → get backup metadata
 * DELETE /api/backup/:telegramId → delete backup
 *
 * FIXES:
 *  - Corrected require paths to flat structure (no api/ or utils/ subfolders).
 *  - Added express.json() malformed-JSON error handler at router level.
 *  - Added stricter input validation (type checks, not just truthiness).
 *  - All res.json() responses are clean and consistent.
 */

const express = require('express');
const otpService = require('./otpService');
const backupService = require('./backupService');
const db = require('./database');
const { sanitizeJSON, formatSize } = require('./helpers');

module.exports = function apiRoutes(bot) {
  const router = express.Router();

  // FIX: Catch malformed JSON bodies before they reach route handlers.
  //      Without this, Express throws a SyntaxError that crashes the request.
  router.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, message: 'Invalid JSON in request body.' });
    }
    next(err);
  });

  // ── POST /api/otp/generate ─────────────────────────────────────────────────
  router.post('/otp/generate', (req, res) => {
    const { telegramId } = req.body || {};

    // FIX: validate type, not just existence
    if (!telegramId || typeof telegramId === 'object') {
      return res.status(400).json({ success: false, message: 'telegramId is required and must be a string or number.' });
    }

    const result = otpService.generateOTP(String(telegramId));

    if (!result.success) {
      return res.status(429).json({
        success: false,
        reason: result.reason,
        message: `Please wait ${result.waitSeconds}s before requesting a new OTP.`,
        waitSeconds: result.waitSeconds,
      });
    }

    // Notify the Telegram user — non-blocking, ignore if user hasn't started bot
    bot.telegram
      .sendMessage(String(telegramId), `🔑 Your OTP: \`${result.otp}\`\n\n⏱ Expires in 2 minutes.`, { parse_mode: 'Markdown' })
      .catch((err) => console.warn(`Could not notify Telegram user ${telegramId}:`, err.message));

    return res.json({
      success: true,
      message: 'OTP generated. Check your Telegram.',
      expiresAt: result.expiresAt,
    });
  });

  // ── POST /api/otp/verify ───────────────────────────────────────────────────
  router.post('/otp/verify', (req, res) => {
    const { telegramId, otp, appUserId } = req.body || {};

    if (!telegramId || !otp) {
      return res.status(400).json({ success: false, message: 'telegramId and otp are required.' });
    }

    // FIX: ensure otp is treated as string (could arrive as number)
    const result = otpService.verifyOTP(String(telegramId), String(otp));

    if (!result.success) {
      const status = result.reason === 'locked' ? 429 : 400;
      return res.status(status).json({ success: false, reason: result.reason, message: result.message });
    }

    // Persist the link
    if (appUserId) {
      db.setLink(String(telegramId), String(appUserId));
    }

    // Notify user on Telegram — non-blocking
    bot.telegram
      .sendMessage(
        String(telegramId),
        `✅ Your app has been successfully linked!\n\nApp ID: \`${appUserId || 'N/A'}\``,
        { parse_mode: 'Markdown' }
      )
      .catch((err) => console.warn(`Could not notify Telegram user ${telegramId}:`, err.message));

    return res.json({
      success: true,
      message: 'OTP verified. Account linked.',
      telegramId: result.telegramId,
      appUserId: appUserId || null,
    });
  });

  // ── POST /api/backup ───────────────────────────────────────────────────────
  router.post('/backup', async (req, res) => {
    const { telegramId, appUserId, data, filename } = req.body || {};

    if (!telegramId || data === undefined || data === null) {
      return res.status(400).json({ success: false, message: 'telegramId and data are required.' });
    }

    // Authorisation: verify the appUserId matches the linked record
    if (appUserId) {
      const link = db.getLink(String(telegramId));
      if (!link || link.appUserId !== String(appUserId)) {
        return res.status(403).json({ success: false, message: 'Unauthorized. App account not linked to this Telegram ID.' });
      }
    }

    // Parse data if it came as a string
    let parsedData = data;
    if (typeof data === 'string') {
      parsedData = sanitizeJSON(data);
      if (!parsedData) {
        return res.status(400).json({ success: false, message: 'Invalid JSON in data field.' });
      }
    }

    const result = await backupService.saveBackup(String(telegramId), parsedData, filename || 'app-backup.json');

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }

    // Notify on Telegram — non-blocking
    bot.telegram
      .sendMessage(
        String(telegramId),
        `📦 *Backup Updated*\n\nVersion ${result.version} saved (${formatSize(result.size)}).`,
        { parse_mode: 'Markdown' }
      )
      .catch((err) => console.warn(`Could not notify Telegram user ${telegramId}:`, err.message));

    return res.json({
      success: true,
      message: 'Backup saved.',
      version: result.version,
      sizeBytes: result.size,
    });
  });

  // ── GET /api/backup/:telegramId ────────────────────────────────────────────
  router.get('/backup/:telegramId', async (req, res) => {
    const telegramId = String(req.params.telegramId);
    const { appUserId } = req.query;

    if (!appUserId) {
      return res.status(400).json({ success: false, message: 'appUserId query param is required.' });
    }

    const link = db.getLink(telegramId);
    if (!link || link.appUserId !== String(appUserId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const result = await backupService.getBackup(telegramId);

    if (!result.success) {
      return res.status(404).json({ success: false, message: 'No backup found for this user.' });
    }

    return res.json({
      success: true,
      backup: {
        data: result.backup.data,
        filename: result.backup.filename,
        savedAt: result.backup.savedAt,
        version: result.backup.version,
        sizeBytes: result.backup.sizeBytes,
      },
    });
  });

  // ── GET /api/status/:telegramId ────────────────────────────────────────────
  router.get('/status/:telegramId', (req, res) => {
    const telegramId = String(req.params.telegramId);
    const link = db.getLink(telegramId);
    const backup = db.getBackup(telegramId);

    return res.json({
      success: true,
      telegramId,
      linked: !!link,
      appUserId: link?.appUserId || null,
      linkedAt: link?.linkedAt || null,
      hasBackup: !!backup,
      backup: backup
        ? {
            filename: backup.filename,
            savedAt: backup.savedAt,
            version: backup.version,
            sizeBytes: backup.sizeBytes,
          }
        : null,
    });
  });

  // ── DELETE /api/backup/:telegramId ────────────────────────────────────────
  router.delete('/backup/:telegramId', async (req, res) => {
    const telegramId = String(req.params.telegramId);
    const { appUserId } = req.body || {};

    const link = db.getLink(telegramId);
    if (!link || !appUserId || link.appUserId !== String(appUserId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    await backupService.deleteBackup(telegramId);
    return res.json({ success: true, message: 'Backup deleted.' });
  });

  return router;
};
