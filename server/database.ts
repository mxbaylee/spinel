import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  // WAL materializes a valid database without changing its schema or migration version.
  // Briefly wait for another local connection (setup, tests, maintenance) to finish
  // its write instead of failing an otherwise valid save immediately.
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return database;
}
