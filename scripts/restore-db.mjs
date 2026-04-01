import 'dotenv/config';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const backupArg = process.argv[2];
if (!backupArg) {
  throw new Error('Usage: npm run restore:db -- <path-to-backup.dump>');
}

const backupPath = path.resolve(process.cwd(), backupArg);
await access(backupPath);

const pgRestoreBin = process.env.PG_RESTORE_BIN?.trim() || 'pg_restore';

const runCommand = async (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      process.stderr.write(chunk);
    });

    child.on('error', (error) => {
      reject(new Error(`${command} failed to start. Check that PostgreSQL client tools are installed. ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = stderr.trim();
      reject(new Error(`${command} exited with code ${code}${details ? `\n${details}` : ''}`));
    });
  });

await runCommand(pgRestoreBin, [
  `--dbname=${databaseUrl}`,
  '--clean',
  '--if-exists',
  '--no-owner',
  '--no-privileges',
  '--single-transaction',
  backupPath,
]);

console.log('database restore finished', { path: backupPath });
