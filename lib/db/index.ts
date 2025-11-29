import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const dbPath = "bank.db";

// Module-level singleton SQLite instance used by the app
const sqlite = new Database(dbPath);
export { sqlite };
export const db = drizzle(sqlite, { schema });

/**
 * Initialize DB schema if missing. This uses the singleton `sqlite` instance
 * and DOES NOT open additional connections to avoid resource leaks.
 */
export function initDb() {
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
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

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      account_number TEXT UNIQUE NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Initialize database on import
initDb();

/**
 * Close database connections held by this module.
 * Call this during graceful shutdown to release file handles.
 */
export function closeDb() {
  try {
    // close the better-sqlite3 connection
    sqlite.close();
    // drizzle wrapper doesn't need explicit close beyond closing sqlite
    // log for observability
    // eslint-disable-next-line no-console
    console.log("Closed SQLite database connection.");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Error closing SQLite DB:", err);
  }
}
