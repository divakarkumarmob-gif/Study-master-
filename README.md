# 🔐 Telegram Backup Bot

A production-ready Telegram bot for mobile app backup and restore, with full REST API integration.

---

## ✨ Features

| Feature | Details |
|---|---|
| **OTP Verification** | 6-digit, expires in 2 min, max 5 attempts |
| **Account Linking** | Links Telegram user ↔ App user ID via OTP |
| **Backup Storage** | JSON file or raw text, up to 5MB, versioned |
| **Restore** | Downloads backup as .json file via Telegram |
| **REST API** | 6 endpoints for mobile app integration |
| **Security** | Rate limiting, attempt lockout, ownership checks |

---

## 📁 Project Structure

```
telegram-backup-bot/
├── bot.js                  ← Main entry point (Telegram bot + Express server)
├── config.js               ← All configuration (env-driven)
├── database.js             ← JSON file persistence layer
├── .env                    ← Environment variables
├── package.json
├── services/
│   ├── otpService.js       ← OTP generation & verification logic
│   └── backupService.js    ← Backup save/retrieve/delete logic
├── api/
│   └── routes.js           ← REST API endpoints for mobile app
├── utils/
│   └── helpers.js          ← Shared utilities
├── tests/
│   └── test.js             ← Automated smoke tests
└── data/
    └── db.json             ← Auto-created database file
```

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
cd telegram-backup-bot
npm install
```

### 2. Configure environment

Edit `.env`:
```env
BOT_TOKEN=your_telegram_bot_token
PORT=3000
DB_PATH=./data/db.json
```

### 3. Run

```bash
npm start          # Production
npm run dev        # Development (auto-restart)
npm test           # Run tests
```

---

## 🤖 Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message + instructions |
| `/otp` | Generate 6-digit OTP (expires in 2 min) |
| `/backup` | Instructions to upload backup |
| `/restore` | Download latest backup as .json file |
| `/status` | View backup info and link status |
| `/help` | Show all commands |

---

## 🌐 REST API Reference

Base URL: `http://localhost:3000/api`

### Generate OTP
```http
POST /api/otp/generate
Content-Type: application/json

{ "telegramId": "123456789" }
```
Response:
```json
{ "success": true, "message": "OTP generated. Check your Telegram.", "expiresAt": 1700000000000 }
```

---

### Verify OTP & Link Account
```http
POST /api/otp/verify
Content-Type: application/json

{
  "telegramId": "123456789",
  "otp": "847291",
  "appUserId": "user_abc123"
}
```
Response:
```json
{ "success": true, "message": "OTP verified. Account linked.", "telegramId": "123456789", "appUserId": "user_abc123" }
```

---

### Upload Backup
```http
POST /api/backup
Content-Type: application/json

{
  "telegramId": "123456789",
  "appUserId": "user_abc123",
  "data": { "settings": {}, "notes": [] },
  "filename": "my-app-backup.json"
}
```
Response:
```json
{ "success": true, "message": "Backup saved.", "version": 2, "sizeBytes": 1024 }
```

---

### Get Backup
```http
GET /api/backup/123456789?appUserId=user_abc123
```
Response:
```json
{
  "success": true,
  "backup": {
    "data": { ... },
    "filename": "my-app-backup.json",
    "savedAt": "2024-01-15T10:30:00.000Z",
    "version": 2,
    "sizeBytes": 1024
  }
}
```

---

### Get Status
```http
GET /api/status/123456789
```
Response:
```json
{
  "success": true,
  "telegramId": "123456789",
  "linked": true,
  "appUserId": "user_abc123",
  "hasBackup": true,
  "backup": { "filename": "...", "savedAt": "...", "version": 2, "sizeBytes": 1024 }
}
```

---

### Delete Backup
```http
DELETE /api/backup/123456789
Content-Type: application/json

{ "appUserId": "user_abc123" }
```

---

## 📱 Mobile App Integration Flow

```
1. App shows "Link Telegram" button
2. User opens bot in Telegram
3. User sends /otp → bot shows 6-digit code
4. User enters code in app
5. App calls POST /api/otp/verify → account linked!
6. App calls POST /api/backup to save data
7. App calls GET /api/backup/:id to restore
```

---

## 🔒 Security

- **OTP Expiry**: 2 minutes
- **Max Attempts**: 5 before lockout
- **Rate Limiting**: 30-second gap between new OTPs
- **Lockout**: 60 seconds after 5 failed attempts
- **Ownership Check**: `appUserId` must match linked record
- **One-Time Use**: OTP is deleted immediately after successful verification
- **Size Limit**: 5MB per backup

---

## ⚙️ Configuration

Edit `config.js` or set environment variables:

| Variable | Default | Description |
|---|---|---|
| `BOT_TOKEN` | (required) | Telegram bot token |
| `PORT` | `3000` | REST API port |
| `DB_PATH` | `./data/db.json` | Database file path |

OTP settings in `config.js`:
```js
OTP: {
  LENGTH: 6,            // digits
  EXPIRY_MS: 120000,    // 2 minutes
  MAX_ATTEMPTS: 5,
  COOLDOWN_MS: 60000,   // lockout duration
  RATE_LIMIT_MS: 30000, // min gap between requests
}
```

---

## 🛠️ Scaling to Production

To scale beyond a JSON file database:

1. **SQLite** — replace `database.js` with `better-sqlite3`
2. **PostgreSQL/MongoDB** — use `pg` or `mongoose` adapters
3. **Redis** — use for OTP storage (TTL built-in)
4. **Webhook mode** — replace `bot.launch()` with `bot.createWebhook()`
