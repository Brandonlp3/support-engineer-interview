const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const dbPath = path.join(__dirname, "..", "bank.db");
const db = new Database(dbPath);

const fs = require('fs');
let HMAC_KEY = process.env.SSN_HMAC_KEY;
// Try to load from .env.local if present
if (!HMAC_KEY) {
  try {
    const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const match = envRaw.match(/^SSN_HMAC_KEY=(.+)$/m);
    if (match) HMAC_KEY = match[1].trim();
  } catch (e) {
    // ignore read errors; will handle below
  }
}

if (!HMAC_KEY) {
  console.error("Error: SSN_HMAC_KEY is required to run the migration. Set the SSN_HMAC_KEY environment variable or add it to .env.local and retry.");
  process.exit(1);
}

const key = Buffer.from(HMAC_KEY, "utf8");

function ssnLookupHash(ssn) {
  return crypto.createHmac("sha256", key).update(ssn).digest("hex");
}
function ssnLast4(ssn) {
  const digits = (ssn || "").replace(/\D/g, "");
  return digits.slice(-4);
}


console.log("Starting SSN migration...");

// Ensure the users table has ssn_hash and ssn_last4 columns. If they are missing, add them.
try {
  const cols = db.prepare("PRAGMA table_info('users')").all().map((c) => c.name);
  if (!cols.includes('ssn_hash')) {
    console.log('Adding column ssn_hash to users table...');
    db.exec('ALTER TABLE users ADD COLUMN ssn_hash TEXT');
  }
  if (!cols.includes('ssn_last4')) {
    console.log('Adding column ssn_last4 to users table...');
    db.exec('ALTER TABLE users ADD COLUMN ssn_last4 TEXT');
  }
} catch (err) {
  console.error('Error ensuring columns exist:', err.message);
  process.exit(1);
}

let rows = [];
try {
  rows = db.prepare("SELECT id, ssn, ssn_hash, ssn_last4 FROM users WHERE ssn IS NOT NULL AND (ssn_hash IS NULL OR ssn_hash = '')").all();
} catch (err) {
  console.error('Could not query users for migration:', err.message);
  process.exit(1);
}

if (!rows || rows.length === 0) {
  console.log('No users found that need migration (either none have plaintext ssn or migration already applied).');
  process.exit(0);
}

const updateStmt = db.prepare('UPDATE users SET ssn_hash = ?, ssn_last4 = ? WHERE id = ?');

const tx = db.transaction((users) => {
  for (const u of users) {
    const hash = ssnLookupHash(u.ssn);
    const last4 = ssnLast4(u.ssn);
    updateStmt.run(hash, last4, u.id);
    console.log(`Migrated user id=${u.id} last4=${last4}`);
  }
});

try {
  tx(rows);
  console.log("Migration completed successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  db.close();
}
