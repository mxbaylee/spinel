/** A real SQLite WAL owner that deliberately survives the app's normal close. */
import { openDatabase } from '../../../server/database.ts';
if (!process.send || !process.env.DATABASE_PATH) throw new Error('Private fixture required.');
const database = openDatabase(process.env.DATABASE_PATH);
database.prepare('SELECT count(*) FROM writes').get();
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
process.send({ opened: true });
