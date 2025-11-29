# SecureBank - SDET Technical Interview

This repository contains a banking application for the Software Development Test Engineer (SDET) technical interview.

## 📋 Challenge Instructions

Please see [CHALLENGE.md](./CHALLENGE.md) for complete instructions and requirements.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start the application
npm run dev

# Open http://localhost:3000
```

## SSN Storage & Migration

This project uses a deterministic HMAC to protect Social Security Numbers (SSNs) for the interview task. The application stores:

- `ssn_hash` — HMAC-SHA256 hex of the full SSN (used for deterministic lookup)
- `ssn_last4` — last 4 digits for display purposes

Important notes:

- You MUST set the `SSN_HMAC_KEY` environment variable before starting the app or running migration scripts. The app will throw an error if this key is missing.
- If you have existing plaintext SSNs in the database, run the migration script BEFORE removing the plaintext column from the schema or DB file. To migrate:

```powershell
$env:SSN_HMAC_KEY = 'your-strong-hmac-key'
node .\scripts\migrate-ssn.js
```

- After verifying migration, the codebase no longer includes the plaintext `ssn` column in the schema. The migration script will detect if the plaintext column is missing and exit with an informative message.

- For production usage, replace this approach with envelope encryption (DEK + KMS KEK) or a tokenization/HSM solution. This HMAC-only approach is acceptable for the take-home exercise but has limitations (key rotation and recoverability) that must be addressed in production.

## 🛠 Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run db:list-users` - List all users in database
- `npm run db:clear` - Clear all database data
- `npm test` - Run tests (you'll need to configure this)

Good luck with the challenge!
