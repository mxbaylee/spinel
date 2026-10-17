import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  // WAL materializes a valid database without changing its schema or migration version.
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return database;
}
