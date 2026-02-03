import { PrismaClient } from '../../src/generated/prisma';
import { execSync } from 'child_process';
import path from 'path';

const getSchemaName = (url: URL) => url.searchParams.get('schema') ?? 'public';

export const getTestDatabaseUrl = () => {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not set');
  }
  const url = new URL(base);
  url.searchParams.set('schema', 'test');
  return url.toString();
};

export const ensureTestSchema = async (testUrl: string) => {
  const url = new URL(testUrl);
  const schema = getSchemaName(url);
  url.searchParams.set('schema', 'public');
  const prisma = new PrismaClient({
    datasources: {
      db: { url: url.toString() },
    },
  });
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await prisma.$disconnect();
};

export const migrateTestDatabase = (testUrl: string) => {
  const cwd = path.resolve(__dirname, '..', '..');
  execSync('npx prisma migrate deploy', {
    cwd,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
};

export const prepareTestDatabase = async () => {
  const testUrl = getTestDatabaseUrl();
  await ensureTestSchema(testUrl);
  migrateTestDatabase(testUrl);
  return testUrl;
};
