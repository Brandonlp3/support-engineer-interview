#!/usr/bin/env node
// scripts/generate-and-fund.js
// Creates a test user, session and account in the local SQLite DB, then repeatedly calls the tRPC endpoint to fund the account.

const Database = require('better-sqlite3');
const path = require('path');
const jwt = require('jsonwebtoken');
let fetch;
try {
  fetch = globalThis.fetch || require('node-fetch');
} catch (e) {
  // node environment without fetch; require node-fetch fallback
  fetch = require('node-fetch');
}

const dbPath = path.join(__dirname, '..', 'bank.db');
const db = new Database(dbPath);

const args = process.argv.slice(2);
const email = args[0] || 'test+auto@example.com';
const iterations = Number(args[1] || 10);
const amount = Number(args[2] || 1.23);
const serverUrl = args[3] || 'http://localhost:3000';
// mode: 'remote' (use tRPC HTTP), 'local' (operate directly on DB)
const mode = args[4] || 'remote';

const JWT_SECRET = process.env.JWT_SECRET || 'temporary-secret-for-interview';

function ensureUser(email) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) return user;

  const stmt = db.prepare(`INSERT INTO users (email, password, first_name, last_name, phone_number, date_of_birth, address, city, state, zip_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // password is dummy; we won't use it
  const info = stmt.run(email, 'password', 'Auto', 'Tester', '000-000-0000', '1990-01-01', '123 Test St', 'Testville', 'TS', '00000');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function ensureSession(user) {
  // Create JWT and session row
  const token = jwt.sign({ userId: user.id }, JWT_SECRET);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

  // Upsert into sessions: delete existing sessions for this user and create a new one
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);
  return { token, expiresAt };
}

function ensureAccount(user) {
  const acc = db.prepare('SELECT * FROM accounts WHERE user_id = ? LIMIT 1').get(user.id);
  if (acc) return acc;

  const accountNumber = Math.floor(Math.random() * 1000000000).toString().padStart(10, '0');
  const info = db.prepare('INSERT INTO accounts (user_id, account_number, account_type, balance, status) VALUES (?, ?, ?, ?, ?)').run(user.id, accountNumber, 'checking', 0, 'active');
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
}

async function callFundAccount(token, accountId, amount) {
  const body = {
    id: Date.now(),
    jsonrpc: '2.0',
    method: 'call',
    params: {
      path: 'account.fundAccount',
      input: {
        accountId,
        amount,
        fundingSource: { type: 'card', accountNumber: '4111111111111111' },
      },
    },
  };

  // Note: Next App Router exposes the handler at /api/trpc/[trpc]
  const res = await fetch(`${serverUrl}/api/trpc/trpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      cookie: `session=${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data;
  } catch (err) {
    // Not JSON — log response for debugging
    return { error: `Unexpected response (status ${res.status}): ${text.slice(0, 1000)}` };
  }
}

(async function main() {
  console.log('Using DB:', dbPath);
  const user = ensureUser(email);
  console.log('User id:', user.id, 'email:', user.email);

  const session = ensureSession(user);
  console.log('Session token created, expiresAt:', session.expiresAt);

  const account = ensureAccount(user);
  console.log('Account id:', account.id, 'number:', account.account_number);

  console.log(`Calling fundAccount ${iterations} times with amount ${amount} to ${serverUrl}...`);

  const results = [];
  if (mode === 'local') {
    // Direct DB mode: perform the same DB operations the server would perform
    for (let i = 0; i < iterations; i++) {
      try {
        await new Promise((r) => setTimeout(r, Math.random() * 50));
        // Insert transaction
        const insert = db.prepare('INSERT INTO transactions (account_id, type, amount, description, status, processed_at) VALUES (?, ?, ?, ?, ?, ?)');
        const now = new Date().toISOString();
        insert.run(account.id, 'deposit', Number(Number(amount).toFixed(2)), `Funding from card`, 'completed', now);

        // Update balance (2-decimal rounding)
        const acc = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id);
        const currentBalance = Number(Number(acc.balance).toFixed(2));
        const newBalance = Number((currentBalance + Number(amount)).toFixed(2));
        db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newBalance, account.id);

        results.push({ ok: true });
      } catch (err) {
        console.error('Local operation failed:', err.message || err);
        results.push({ error: err.message || String(err) });
      }
    }
  } else {
    for (let i = 0; i < iterations; i++) {
      try {
        // small random delay to simulate race conditions
        await new Promise((r) => setTimeout(r, Math.random() * 50));
        const r = await callFundAccount(session.token, account.id, amount);
        results.push(r);
        if (r.error) console.error('Call error:', r.error);
      } catch (err) {
        console.error('Request failed:', err.message || err);
        results.push({ error: err.message || String(err) });
      }
    }
  }

  console.log('\nCompleted calls. Summary:');
  const success = results.filter((r) => !r.error).length;
  console.log(`Success: ${success}/${iterations}`);

  console.log('\nDB transactions for account:');
  const txs = db.prepare('SELECT id, type, amount, description, status, created_at FROM transactions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
  console.log(`Total transactions in DB: ${txs.length}`);
  txs.slice(-10).forEach((t) => console.log(t));

  console.log('\nAccount row:');
  const accAfter = db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id);
  console.log(accAfter);

  db.close();
})();
