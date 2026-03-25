import 'dotenv/config';
import { spawn } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildBackupFileName,
  DEFAULT_BACKUP_DIR,
  DEFAULT_BACKUP_PREFIX,
  DEFAULT_BACKUP_RETENTION_COUNT,
  megabytesToBytes,
  normalizeBotApiBaseUrl,
  isManagedBackupFile,
  normalizePositiveInteger,
  resolveTelegramUploadLimitMb,
  selectBackupFilesToPrune,
} from './db-backup-lib.mjs';

const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}
const botToken = String(process.env.BOT_TOKEN ?? '').trim();
if (!botToken) {
  throw new Error('BOT_TOKEN is not set');
}

const telegramChatId = String(process.env.ADMIN_TELEGRAM_ID ?? '').trim();
if (!telegramChatId) {
  throw new Error('ADMIN_TELEGRAM_ID is not set');
}

const backupDir = path.resolve(process.env.BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIR);
const backupPrefix = process.env.BACKUP_FILE_PREFIX?.trim() || DEFAULT_BACKUP_PREFIX;
const retentionCount = normalizePositiveInteger(
  process.env.BACKUP_RETENTION_COUNT,
  DEFAULT_BACKUP_RETENTION_COUNT,
  { min: 1, max: 365 },
);
const pgDumpBin = process.env.PG_DUMP_BIN?.trim() || 'pg_dump';
const telegramBotApiBaseUrl = normalizeBotApiBaseUrl(process.env.TELEGRAM_BOT_API_BASE_URL);
const telegramUploadLimitMb = resolveTelegramUploadLimitMb(
  process.env.TELEGRAM_MAX_UPLOAD_MB,
  telegramBotApiBaseUrl,
);
const telegramUploadLimitBytes = megabytesToBytes(telegramUploadLimitMb);

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

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const buildTelegramApiUrl = (method) =>
  `${telegramBotApiBaseUrl}/bot${botToken}/${method}`;

const sendTelegramMessage = async (text) => {
  const response = await fetch(buildTelegramApiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with status ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(`Telegram sendMessage failed: ${payload?.description ?? 'unknown error'}`);
  }
};

const sendBackupToTelegram = async (backupPath, sizeText) => {
  const form = new FormData();
  form.set('chat_id', telegramChatId);
  form.set(
    'caption',
    [
      'DB backup ready',
      `file: ${path.basename(backupPath)}`,
      `size: ${sizeText}`,
      `host: ${os.hostname()}`,
    ].join('\n'),
  );
  form.set('document', await openAsBlob(backupPath), path.basename(backupPath));

  const response = await fetch(buildTelegramApiUrl('sendDocument'), {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Telegram sendDocument failed with status ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(`Telegram sendDocument failed: ${payload?.description ?? 'unknown error'}`);
  }
};

await mkdir(backupDir, { recursive: true });

const backupPath = path.join(backupDir, buildBackupFileName(backupPrefix));

try {
  await runCommand(pgDumpBin, [
    `--dbname=${databaseUrl}`,
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${backupPath}`,
  ]);
} catch (error) {
  await rm(backupPath, { force: true }).catch(() => {});
  throw error;
}

const entries = await readdir(backupDir, { withFileTypes: true });
const managedFiles = [];

for (const entry of entries) {
  if (!entry.isFile()) continue;
  if (!isManagedBackupFile(entry.name, backupPrefix)) continue;
  const filePath = path.join(backupDir, entry.name);
  const fileStat = await stat(filePath);
  managedFiles.push({
    name: entry.name,
    path: filePath,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
  });
}

const filesToPrune = selectBackupFilesToPrune(managedFiles, retentionCount);
for (const file of filesToPrune) {
  await rm(file.path, { force: true });
}

const backupStat = await stat(backupPath);
const sizeText = formatSize(backupStat.size);
if (backupStat.size > telegramUploadLimitBytes) {
  const warning = [
    'DB backup created, but Telegram upload was skipped.',
    `file: ${path.basename(backupPath)}`,
    `size: ${sizeText}`,
    `telegram_limit: ${telegramUploadLimitMb} MB`,
    `local_path: ${backupPath}`,
    'Action required: increase transport capacity or pull the file from the server.',
  ].join('\n');

  await sendTelegramMessage(warning);
  throw new Error(
    `backup created at ${backupPath}, but upload skipped because ${sizeText} exceeds Telegram limit ${telegramUploadLimitMb} MB`,
  );
}

await sendBackupToTelegram(backupPath, sizeText);

console.log('database backup created', {
  path: backupPath,
  size: sizeText,
  telegramChatId,
  telegramBotApiBaseUrl,
  telegramUploadLimitMb,
  keptBackups: Math.min(managedFiles.length, retentionCount),
  prunedBackups: filesToPrune.length,
});
