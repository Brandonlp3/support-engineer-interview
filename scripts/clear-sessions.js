#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'bank.db');
const db = new Database(dbPath);

const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--all') opts.all = true;
  if (a === '--email') opts.email = args[i + 1], i++;
  if (a === '--before') opts.before = args[i + 1], i++;
  if (a === '--after') opts.after = args[i + 1], i++;
  if (a === '--dry') opts.dry = true;
}

function listMatching() {
  let rows;
  if (opts.email) {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(opts.email);
    if (!user) {
      console.log('No user with that email');
      return [];
    }
    rows = db.prepare('SELECT s.id, s.user_id, s.token, s.expires_at, u.email FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE s.user_id = ? ORDER BY s.expires_at ASC').all(user.id);
  } else if (opts.before) {
    rows = db.prepare('SELECT s.id, s.user_id, s.token, s.expires_at, u.email FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE s.expires_at < ? ORDER BY s.expires_at ASC').all(opts.before);
  } else if (opts.after) {
    rows = db.prepare('SELECT s.id, s.user_id, s.token, s.expires_at, u.email FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE s.expires_at > ? ORDER BY s.expires_at ASC').all(opts.after);
  } else if (opts.all) {
    rows = db.prepare('SELECT s.id, s.user_id, s.token, s.expires_at, u.email FROM sessions s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.expires_at ASC').all();
  } else {
    // default: list all
    rows = db.prepare('SELECT s.id, s.user_id, s.token, s.expires_at, u.email FROM sessions s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.expires_at ASC').all();
  }
  return rows;
}

function run() {
  const rows = listMatching();
  if (!rows || rows.length === 0) {
    console.log('No matching sessions');
    db.close();
    return;
  }

  console.log(`Found ${rows.length} session(s):`);
  rows.forEach((s) => {
    const isExpired = new Date(s.expires_at) < new Date();
    console.log(`ID:${s.id} user:${s.email || s.user_id} expires:${s.expires_at} ${isExpired ? '(EXPIRED)' : '(ACTIVE)'} token:${s.token.substring(0,20)}...`);
  });

  if (opts.dry) {
    console.log('\nDry run; not deleting.');
    db.close();
    return;
  }

  // Perform deletion based on same criteria
  let info;
  if (opts.email) {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(opts.email);
    info = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  } else if (opts.before) {
    info = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(opts.before);
  } else if (opts.after) {
    info = db.prepare('DELETE FROM sessions WHERE expires_at > ?').run(opts.after);
  } else if (opts.all) {
    info = db.prepare('DELETE FROM sessions').run();
  } else {
    console.log('\nNo delete criteria provided; use --all, --email <email>, --before <ISO>, or --after <ISO>, or add --dry to preview.');
    db.close();
    return;
  }

  console.log(`\nDeleted ${info.changes} session(s).`);
  db.close();
}

run();
