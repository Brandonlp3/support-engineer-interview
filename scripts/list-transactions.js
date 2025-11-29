const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'bank.db');
const db = new Database(dbPath);

const email = process.argv[2];
if (!email) {
  console.log('Usage: node scripts/list-transactions.js <email>');
  process.exit(1);
}

const user = db.prepare('SELECT id, email, first_name, last_name FROM users WHERE email = ?').get(email);
if (!user) {
  console.log(`User with email ${email} not found.`);
  process.exit(1);
}

const accounts = db.prepare('SELECT id, account_number, account_type, balance FROM accounts WHERE user_id = ?').all(user.id);
if (accounts.length === 0) {
  console.log(`No accounts found for user ${email}`);
  process.exit(0);
}

for (const acc of accounts) {
  console.log(`\nAccount: id=${acc.id} number=${acc.account_number} type=${acc.account_type} balance=${acc.balance}`);
  const txs = db.prepare('SELECT id, type, amount, description, status, created_at, processed_at FROM transactions WHERE account_id = ? ORDER BY created_at ASC').all(acc.id);
  if (txs.length === 0) {
    console.log('  No transactions for this account');
  } else {
    for (const t of txs) {
      console.log(`  TX id=${t.id} type=${t.type} amount=${t.amount} status=${t.status} created=${t.created_at} processed=${t.processed_at} desc=${t.description}`);
    }
  }
}

db.close();
