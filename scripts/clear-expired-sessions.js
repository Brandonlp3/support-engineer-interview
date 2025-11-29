const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'bank.db');
const db = new Database(dbPath);

function listSessions() {
  const sessions = db.prepare(`
    SELECT s.id, s.token, s.expires_at, u.email
    FROM sessions s
    LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.expires_at ASC
  `).all();

  if (sessions.length === 0) {
    console.log('No sessions present');
    return sessions;
  }

  console.log('\nCurrent sessions:');
  sessions.forEach((s) => {
    const isExpired = new Date(s.expires_at) < new Date();
    console.log(`ID:${s.id} user:${s.email || 'unknown'} expires:${s.expires_at} ${isExpired ? '(EXPIRED)' : '(ACTIVE)'} token:${s.token.substring(0,20)}...`);
  });
  return sessions;
}

function clearExpired() {
  const now = new Date().toISOString();
  const expired = db.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE expires_at < ?').get(now).cnt;
  if (expired === 0) {
    console.log('\nNo expired sessions to delete.');
    return 0;
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  console.log(`\nDeleted ${expired} expired session(s).`);
  return expired;
}

(function main() {
  console.log('Using DB:', dbPath);
  listSessions();
  clearExpired();
  listSessions();
  db.close();
})();
