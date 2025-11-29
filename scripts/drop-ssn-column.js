const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'bank.db');
const backupPath = path.join(__dirname, '..', `bank.db.bak.${Date.now()}`);

console.log('Creating backup of database at', backupPath);
fs.copyFileSync(dbPath, backupPath);

const db = new Database(dbPath);

try {
  const cols = db.prepare("PRAGMA table_info('users')").all().map(c => c.name);
  if (!cols.includes('ssn')) {
    console.log('`ssn` column not found on users table; nothing to do.');
    process.exit(0);
  }

  console.log('Found `ssn` column — proceeding to remove it.');

  db.exec('PRAGMA foreign_keys = OFF;');
  const tx = db.transaction(() => {
    // Create new users table without the ssn column
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        ssn_hash TEXT,
        ssn_last4 TEXT,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        zip_code TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Copy data from old users table to new, excluding ssn
    const copyCols = ['id','email','password','first_name','last_name','phone_number','date_of_birth','ssn_hash','ssn_last4','address','city','state','zip_code','created_at'];
    db.prepare(`INSERT INTO users_new (${copyCols.join(',')}) SELECT ${copyCols.join(',')} FROM users`).run();

    // Drop old users table and rename new one
    db.exec('DROP TABLE users;');
    db.exec('ALTER TABLE users_new RENAME TO users;');

    // Recreate any foreign key indexes/constraints will be preserved by name; ensure accounts foreign key still references users(id)
    // If you had triggers/indexes on users they must be recreated here. This schema mirrors the app's CREATE TABLE.
  });

  tx();
  db.exec('PRAGMA foreign_keys = ON;');

  console.log('Successfully removed `ssn` column. Backup stored at', backupPath);
} catch (err) {
  console.error('Failed to remove `ssn` column:', err.message);
  console.error('Database backup is at', backupPath);
  process.exit(1);
} finally {
  db.close();
}
