#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');
const jwt = require('jsonwebtoken');

const dbPath = path.join(__dirname, '..', 'bank.db');
const db = new Database(dbPath);

const SECRET = process.env.JWT_SECRET || 'temporary-secret-for-interview';
const SAFETY_MS = Number(process.env.SESSION_EXPIRY_SAFETY_MS || 30000);

function makeRandomEmail() {
  return `test+${Math.random().toString(36).slice(2,8)}@example.com`;
}

async function run() {
  try {
    // Create a minimal user
    const email = makeRandomEmail();
    const nowIso = new Date().toISOString();
    const info = db.prepare(`INSERT INTO users (email, password, first_name, last_name, phone_number, date_of_birth, address, city, state, zip_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(email, 'password', 'Test', 'User', '+10000000000', '1990-01-01', '123 Test St', 'Testville', 'TX', '75001', nowIso);

    const userId = info.lastInsertRowid;
    console.log('Created user id', userId, 'email', email);

    // Create JWT token (long lived) but session row will control expiration
    const token = jwt.sign({ userId }, SECRET, { expiresIn: '7d' });

    // Insert a session that expires in 20 seconds
    const expiresAt = new Date(Date.now() + 20 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(userId, token, expiresAt);
    console.log('Inserted session token expiring at', expiresAt);

    // Emulate server-side check: fetch session and decide
    const sessionRow = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!sessionRow) {
      console.error('Session row not found after insert (unexpected)');
      process.exitCode = 2;
      return;
    }

    const expiresInMs = new Date(sessionRow.expires_at).getTime() - Date.now();
    console.log('Session expires in (ms):', expiresInMs, 'safetyMs:', SAFETY_MS);

    if (expiresInMs <= SAFETY_MS) {
      console.log('Session is within safety window or expired -> revoking now');
      const del = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionRow.id);
      console.log('Deleted rows:', del.changes);
    } else {
      console.log('Session is considered valid (outside safety window)');
    }

    // Re-check
    const after = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!after) {
      console.log('Session revoked successfully (row gone). Test PASS');
    } else {
      console.log('Session still present. Test FAIL (row remains).');
    }

    // cleanup: delete user and any sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.close();
  } catch (err) {
    console.error('Error during test:', err);
    try { db.close(); } catch (e) {}
    process.exitCode = 1;
  }
}

run();
