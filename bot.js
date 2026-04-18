/**
 * Telegram Backup Bot — Main Entry Point
 * Handles all Telegram bot commands and interactions
 *
 * FIXES applied:
 *  1. Require paths updated to flat structure (no services/, api/, utils/ subfolders).
 *  2. Native fetch guard: Node 18+ has fetch built-in; added runtime check with
 *     a clear error if somehow running on an older version.
 *  3. BOT_TOKEN is now validated inside config.js — process exits before Telegraf
 *     ever tries to connect with an undefined token.
 *  4. bot.launch() wrapped in try/catch with graceful fallback logging.
 *  5. Express server error handler added so invalid JSON bodies return 400
 *     instead of crashing the process.
 *  6. process.env.PORT used correctly via config.PORT (Number(), not parseInt).
 *  7. Unhandled promise rejections and uncaught exceptions are now caught at
 *     process level to prevent silent Railway restarts.
 */

// ─── Node.js fetch compatibility check ───────────────────────────────────────
// Native fetch is available in Node 18+. The engines field in package.json
// enforces >=18, but this runtime check gives a clear error if something is wrong.
if (typeof fetch === 'undefined') {
  console.error('❌ FATAL: fetch is not defined. Please use Node.js 18 or later.');
  process.exit(1);
}

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const config = require('./config');           // validates BOT_TOKEN, exits if missing
const db = require('./database');
const otpService = require('./otpService');
const backupService = require('./backupService');
const apiRoutes = require('./routes');
const { formatSize, sanitizeJSON } = require('./helpers');

const bot = new Telegraf(config.BOT_TOKEN);
const app = express();

// ─── EXPRESS MIDDLEWARE ───────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));

// FIX: Catch malformed JSON bodies (e.g. from the mobile app sending bad data).
//      Without this, Express throws an unhandled SyntaxError.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body.' });
  }
  next(err);
});

// ─── BOT MIDDLEWARE ───────────────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[${new Date().toISOString()}] ${ctx.updateType} from @${ctx.from?.username || ctx.from?.id} — ${ms}ms`);
});

// ─── /start ───────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  const name = ctx.from.first_name || 'there';
  const welcomeMsg = `
🔐 *Welcome to Backup Bot, ${name}!*

I securely store and restore your app data using your Telegram account as identity.

━━━━━━━━━━━━━━━━━━━━━━
📋 *Available Commands:*

/otp — Generate a one-time password to link your app
/backup — Upload your backup data (JSON)
/restore — Download your latest backup
/status — View your backup info
/help — Show this message again

━━━━━━━━━━━━━━━━━━━━━━
🚀 *Getting Started:*

1️⃣ Open your app and tap "Link Telegram"
2️⃣ Use /otp here to get your 6-digit code
3️⃣ Enter the code in your app to link accounts
4️⃣ Your app will auto-backup via this bot!

Your Telegram ID: \`${ctx.from.id}\`
  `;

  await ctx.replyWithMarkdown(welcomeMsg,
    Markup.keyboard([
      ['🔑 Generate OTP', '📦 My Backup Status'],
      ['📤 Restore Backup', '❓ Help']
    ]).resize()
  );
});

// ─── /otp ─────────────────────────────────────────────────────────────────────

bot.command('otp', handleOTP);
bot.hears('🔑 Generate OTP', handleOTP);

async function handleOTP(ctx) {
  const telegramId = String(ctx.from.id);

  try {
    const result = otpService.generateOTP(telegramId);

    if (!result.success) {
      return ctx.replyWithMarkdown(
        `⏳ *OTP Rate Limit*\n\nYou already have an active OTP.\nTry again in *${result.waitSeconds}* seconds.`
      );
    }

    const msg = `
🔑 *Your OTP Code*

\`${result.otp}\`

⏱ Expires in: *2 minutes*
🔒 Do not share this code with anyone.

Enter this code in your app to link your Telegram account.
    `;

    const sent = await ctx.replyWithMarkdown(msg);

    // Auto-delete the OTP message after 2 minutes for security
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id);
      } catch (_) { /* message may already be deleted */ }
    }, 120_000);

  } catch (err) {
    console.error('OTP error:', err);
    await ctx.reply('❌ Failed to generate OTP. Please try again.');
  }
}

// ─── /backup ──────────────────────────────────────────────────────────────────

bot.command('backup', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📤 *Send Your Backup*\n\nSend me your backup as:\n• A *.json* file attachment\n• Or paste raw JSON text\n\nI'll store it securely linked to your Telegram ID.`
  );
});

// Handle document uploads (JSON files)
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;

  if (!doc.mime_type?.includes('json') && !doc.file_name?.endsWith('.json')) {
    return ctx.reply('⚠️ Please send a valid .json file.');
  }

  if (doc.file_size > 5 * 1024 * 1024) {
    return ctx.reply('❌ File too large. Maximum backup size is 5MB.');
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);

    // FIX: native fetch (Node 18+) — no need for node-fetch package.
    //      The fetch check at the top of this file ensures we fail fast
    //      if somehow running on an older Node version.
    const response = await fetch(fileLink.href);

    if (!response.ok) {
      throw new Error(`Telegram file fetch failed: ${response.status}`);
    }

    const rawText = await response.text();
    await processBackup(ctx, rawText, doc.file_name);

  } catch (err) {
    console.error('Document backup error:', err);
    await ctx.reply('❌ Failed to read file. Please try again.');
  }
});

// Handle text messages as potential JSON backup
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Skip if it's a command or keyboard button
  if (
    text.startsWith('/') ||
    ['🔑 Generate OTP', '📦 My Backup Status', '📤 Restore Backup', '❓ Help'].includes(text)
  ) {
    return;
  }

  // Try to parse as JSON
  if (text.startsWith('{') || text.startsWith('[')) {
    await processBackup(ctx, text, 'inline-backup.json');
  } else {
    await ctx.reply('💡 Send a .json file or use /help to see available commands.');
  }
});

async function processBackup(ctx, rawText, filename) {
  const telegramId = String(ctx.from.id);

  try {
    const parsed = sanitizeJSON(rawText);

    if (!parsed) {
      return ctx.reply('❌ Invalid JSON format. Please check your backup file.');
    }

    const result = await backupService.saveBackup(telegramId, parsed, filename);

    if (result.success) {
      await ctx.replyWithMarkdown(
        `✅ *Backup Saved Successfully!*\n\n` +
        `📁 File: \`${filename}\`\n` +
        `📊 Size: ${formatSize(result.size)}\n` +
        `🕐 Saved: ${new Date().toLocaleString()}\n\n` +
        `Use /restore to retrieve this backup anytime.`
      );
    } else {
      await ctx.reply(`❌ Failed to save backup: ${result.error}`);
    }
  } catch (err) {
    console.error('Backup processing error:', err);
    await ctx.reply('❌ Something went wrong while saving your backup.');
  }
}

// ─── /restore ─────────────────────────────────────────────────────────────────

bot.command('restore', handleRestore);
bot.hears('📤 Restore Backup', handleRestore);

async function handleRestore(ctx) {
  const telegramId = String(ctx.from.id);

  try {
    const result = await backupService.getBackup(telegramId);

    if (!result.success) {
      return ctx.replyWithMarkdown(
        `📭 *No Backup Found*\n\nYou don't have any stored backup yet.\n\nUse /backup to upload your data.`
      );
    }

    const { backup } = result;
    const jsonString = JSON.stringify(backup.data, null, 2);
    const buffer = Buffer.from(jsonString, 'utf-8');

    await ctx.replyWithDocument(
      { source: buffer, filename: `backup_${telegramId}_${Date.now()}.json` },
      {
        caption:
          `📦 *Your Backup*\n\n` +
          `📊 Size: ${formatSize(buffer.length)}\n` +
          `🕐 Saved on: ${new Date(backup.savedAt).toLocaleString()}\n` +
          `📁 Original: ${backup.filename}`,
        parse_mode: 'Markdown'
      }
    );
  } catch (err) {
    console.error('Restore error:', err);
    await ctx.reply('❌ Failed to retrieve backup. Please try again.');
  }
}

// ─── /status ──────────────────────────────────────────────────────────────────

bot.command('status', handleStatus);
bot.hears('📦 My Backup Status', handleStatus);

async function handleStatus(ctx) {
  const telegramId = String(ctx.from.id);
  const backup = db.getBackup(telegramId);
  const link = db.getLink(telegramId);

  let msg = `📊 *Your Backup Status*\n\n`;
  msg += `🆔 Telegram ID: \`${telegramId}\`\n`;
  msg += `🔗 App Linked: ${link ? `✅ App ID \`${link.appUserId}\`` : '❌ Not linked'}\n\n`;

  if (backup) {
    const size = Buffer.byteLength(JSON.stringify(backup.data));
    msg += `📦 *Latest Backup:*\n`;
    msg += `• File: \`${backup.filename}\`\n`;
    msg += `• Size: ${formatSize(size)}\n`;
    msg += `• Saved: ${new Date(backup.savedAt).toLocaleString()}\n`;
    msg += `• Version: ${backup.version || 1}`;
  } else {
    msg += `📭 No backup stored yet.`;
  }

  await ctx.replyWithMarkdown(msg);
}

// ─── /help ────────────────────────────────────────────────────────────────────

bot.command('help', handleHelp);
bot.hears('❓ Help', handleHelp);

async function handleHelp(ctx) {
  await ctx.replyWithMarkdown(`
🤖 *Backup Bot — Help*

━━━━━━━━━━━━━━━━━━━━━━
*Commands:*
/start — Welcome screen
/otp — Generate 6-digit OTP (expires in 2 min)
/backup — Instructions to send backup
/restore — Get your latest backup
/status — View backup info & link status
/help — This help message

━━━━━━━━━━━━━━━━━━━━━━
*How to link your app:*
1. Tap "Link Telegram" in your app
2. Run /otp here to get your code
3. Enter the code in your app
4. Done! Backups will sync automatically.

━━━━━━━━━━━━━━━━━━━━━━
*Backup formats supported:*
• JSON file (.json attachment)
• Raw JSON text (paste directly)

Max backup size: *5MB*
  `);
}

// ─── BOT ERROR HANDLER ────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx?.updateType}:`, err);
  // FIX: guard against ctx being undefined in some edge cases
  if (ctx) {
    ctx.reply('⚠️ An unexpected error occurred. Please try again.').catch(() => {});
  }
});

// ─── REST API ─────────────────────────────────────────────────────────────────

app.use('/api', apiRoutes(bot));

// Health check endpoint — used by Railway to verify the service is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// FIX: Catch-all Express error handler — prevents unhandled errors from
//      crashing the process when an Express route throws.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Express error:', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ─── LAUNCH ───────────────────────────────────────────────────────────────────

async function launch() {
  // Initialise DB (creates folder + file if needed)
  db.init();
  console.log('✅ Database initialized');

  // Start Express — Railway injects PORT automatically
  const PORT = config.PORT;
  app.listen(PORT, '0.0.0.0', () => {
    // FIX: bind to 0.0.0.0 so Railway's proxy can reach the process
    console.log(`✅ REST API running on port ${PORT}`);
  });

  // FIX: bot.launch() can throw if the token is invalid or network is down.
  //      Wrap in try/catch so the Express server stays up even if the bot fails.
  try {
    await bot.launch();
    console.log('✅ Telegram bot is live!');
  } catch (err) {
    console.error('❌ Failed to launch Telegram bot:', err.message);
    // Do NOT exit — keep the HTTP server alive so Railway doesn't restart in a loop.
    // The bot can be restarted manually or via a Railway redeploy.
  }
}

launch().catch((err) => {
  console.error('❌ Fatal launch error:', err);
  process.exit(1);
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

process.once('SIGINT', () => {
  console.log('🛑 SIGINT received — stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 SIGTERM received — stopping bot...');
  bot.stop('SIGTERM');
});

// FIX: Catch unhandled promise rejections to prevent Railway silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught Exception:', err);
  // Don't exit — log and keep running unless it's truly fatal
});
