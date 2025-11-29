#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'bank.db');
const db = new Database(dbPath);

// Usage: node transaction_benchmark.js [count]
const args = process.argv.slice(2);
const COUNT = Number(args[0]) || 1000;

function ensureUserAndAccount() {
  const email = `perf+${Math.random().toString(36).slice(2,8)}@example.com`;
  const now = new Date().toISOString();
  const res = db.prepare(`INSERT INTO users (email, password, first_name, last_name, phone_number, date_of_birth, address, city, state, zip_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(email, 'password', 'Perf', 'Tester', '+10000000000', '1985-01-01', '1 Perf St', 'PerfCity', 'CA', '90001', now);
  const userId = res.lastInsertRowid;
  const acct = db.prepare(`INSERT INTO accounts (user_id, account_number, account_type, balance, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, `ACCT${Date.now()}${Math.floor(Math.random()*1000)}`, 'checking', 0, 'active', now);
  const accountId = acct.lastInsertRowid;
  return { userId, accountId };
}

function timeIt(name, fn) {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ns = Number(end - start);
  const ms = ns / 1e6;
  const opsPerSec = (COUNT / (ms / 1000)).toFixed(2);
  console.log(`${name}: ${ms.toFixed(2)}ms for ${COUNT} ops — ${opsPerSec} ops/sec`);
}

function serialInsert(accountId) {
  const insert = db.prepare('INSERT INTO transactions (account_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < COUNT; i++) {
    insert.run(accountId, 'deposit', 0.01, `perf deposit ${i}`, 'processed', new Date().toISOString());
  }
}

function batchedInsert(accountId) {
  const insert = db.prepare('INSERT INTO transactions (account_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertMany = db.transaction((n) => {
    for (let i = 0; i < n; i++) {
      insert.run(accountId, 'deposit', 0.01, `perf deposit ${i}`, 'processed', new Date().toISOString());
    }
  });
  insertMany(COUNT);
}

function cleanup(accountId, userId) {
  db.prepare('DELETE FROM transactions WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

(function run() {
  console.log(`Benchmark starting — COUNT=${COUNT}`);
  const { userId, accountId } = ensureUserAndAccount();
  try {
    timeIt('Serial inserts (no explicit txn)', () => serialInsert(accountId));
    // cleanup intermediate rows so batched test runs on empty table
    db.prepare('DELETE FROM transactions WHERE account_id = ?').run(accountId);

    timeIt('Batched inserts (single DB transaction)', () => batchedInsert(accountId));
  } finally {
    cleanup(accountId, userId);
    db.close();
  }
})();
