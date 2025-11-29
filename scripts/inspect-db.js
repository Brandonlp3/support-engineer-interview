const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'bank.db');
const db = new Database(dbPath, { readonly: true });

try {
  const cols = db.prepare("PRAGMA table_info('users')").all();
  console.log('COLUMNS:');
  cols.forEach((c) => console.log(`  ${c.cid}: ${c.name} (${c.type})`));

  console.log('\nSAMPLE ROWS:');
  const rows = db.prepare('SELECT id, email, ssn_hash, ssn_last4 FROM users LIMIT 5').all();
  if (rows.length === 0) {
    console.log('  (no rows)');
  } else {
    rows.forEach((r) => console.log(JSON.stringify(r)));
  }
} catch (err) {
  console.error('Error inspecting DB:', err.message);
} finally {
  db.close();
}
