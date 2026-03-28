import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildBackupFileName, DEFAULT_BACKUP_DIR, DEFAULT_BACKUP_PREFIX } from './db-backup-lib.mjs';

const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const backupDirArg = process.argv[2]?.trim();
const backupPrefixArg = process.argv[3]?.trim();
const backupDir = path.resolve(process.cwd(), backupDirArg || DEFAULT_BACKUP_DIR);
const backupPrefix = backupPrefixArg || DEFAULT_BACKUP_PREFIX;
const pgDumpBin = process.env.PG_DUMP_BIN?.trim() || 'pg_dump';

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

await mkdir(backupDir, { recursive: true });

const backupPath = path.join(backupDir, buildBackupFileName(backupPrefix));

await runCommand(pgDumpBin, [
  `--dbname=${databaseUrl}`,
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  `--file=${backupPath}`,
]);

console.log(backupPath);
