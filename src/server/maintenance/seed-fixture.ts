/** Seed exits to release native SQLite handles before the recovery fixture starts. */
import { openDatabase } from '../../../server/database.ts';
if (!process.send || !process.env.DATABASE_PATH) throw new Error('Private fixture required.');
const database = openDatabase(process.env.DATABASE_PATH);
database.exec('CREATE TABLE writes (value TEXT NOT NULL)');
database.prepare('INSERT INTO writes VALUES(?)').run('original');
database.close();
process.disconnect?.();
