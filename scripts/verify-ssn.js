const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'bank.db');
const db = new Database(dbPath, { readonly: true });

function loadHmacKey() {
  let key = process.env.SSN_HMAC_KEY;
  if (!key) {
    try {
      const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
      const match = envRaw.match(/^SSN_HMAC_KEY=(.+)$/m);
      if (match) key = match[1].trim();
    } catch (e) {}
  }
  return key;
}

function ssnLookupHash(ssn, key) {
  return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(ssn).digest('hex');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage:');
  console.log('  node scripts/verify-ssn.js find --last4 <digits>');
  console.log('  node scripts/verify-ssn.js check <9-digit-ssn>');
  process.exit(0);
}

const cmd = args[0];
if (cmd === 'find') {
  const i = args.indexOf('--last4');
  if (i === -1 || !args[i+1]) {
    console.error('Please provide --last4 <digits>');
    process.exit(1);
  }
  const last4 = args[i+1].replace(/\D/g, '').slice(-4);
  const rows = db.prepare('SELECT id,email,ssn_hash,ssn_last4 FROM users WHERE ssn_last4 = ?').all(last4);
  if (!rows || rows.length === 0) {
    console.log('No users found with last4=' + last4);
    process.exit(0);
  }
  rows.forEach(r => console.log(JSON.stringify(r)));
  process.exit(0);
} else if (cmd === 'check') {
  const ssn = args[1];
  if (!ssn || !/^\d{9}$/.test(ssn.replace(/\D/g, ''))) {
    console.error('Please provide a 9-digit SSN to check, e.g. node scripts/verify-ssn.js check 123456789');
    process.exit(1);
  }
  const key = loadHmacKey();
  if (!key) {
    console.error('SSN_HMAC_KEY not found in env or .env.local');
    process.exit(1);
  }
  const hash = ssnLookupHash(ssn, key);
  const row = db.prepare('SELECT id,email,ssn_hash,ssn_last4 FROM users WHERE ssn_hash = ?').get(hash);
  if (!row) {
    console.log('No match for provided SSN (hash not found)');
    process.exit(0);
  }
  console.log('Match found:', JSON.stringify(row));
  process.exit(0);
} else {
  console.error('Unknown command:', cmd);
  process.exit(1);
}
