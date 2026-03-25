import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let findWordsNeedingSentences: (limit: number) => Promise<any[]>;
let countWordsNeedingSentences: () => Promise<number>;
let removeSentenceAtIndex: (wordId: number, index: number) => Promise<{ sentences: any[]; removed: boolean }>;
let appendSentences: (wordId: number, newSentences: any[], maxCount?: number) => Promise<void>;
let advanceSentenceIndex: (wordId: number) => Promise<void>;
let getSentenceForReview: (word: { exampleSentences: any; sentenceIndex: number }) => { sentence: any; index: number } | null;

const userId = BigInt(900000220);

beforeAll(async () => {
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  const sentenceService = await import('../src/services/sentenceService');
  findWordsNeedingSentences = sentenceService.findWordsNeedingSentences;
  countWordsNeedingSentences = sentenceService.countWordsNeedingSentences;
  removeSentenceAtIndex = sentenceService.removeSentenceAtIndex;
  appendSentences = sentenceService.appendSentences;
  advanceSentenceIndex = sentenceService.advanceSentenceIndex;
  getSentenceForReview = sentenceService.getSentenceForReview;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  await prisma.user.create({ data: { id: userId, language: 'ru' } });
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma?.$disconnect();
});

describe('sentenceService integration', () => {
  it('finds words that have fewer than 3 example sentences', async () => {
    const beforeCount = await countWordsNeedingSentences();

    const withNull = await prisma.word.create({
      data: {
        userId,
        wordEn: 'null-example',
        translationRu: 'пример-null',
      },
    });
    const withOne = await prisma.word.create({
      data: {
        userId,
        wordEn: 'one-example',
        translationRu: 'пример-1',
        exampleSentences: [{ en: 'I keep one sample.', native: 'Я храню один пример.' }] as any,
      },
    });
    const withTwo = await prisma.word.create({
      data: {
        userId,
        wordEn: 'two-examples',
        translationRu: 'пример-2',
        exampleSentences: [
          { en: 'The first sample is ready.', native: 'Первый пример готов.' },
          { en: 'The second sample is ready.', native: 'Второй пример готов.' },
        ] as any,
      },
    });
    const withThree = await prisma.word.create({
      data: {
        userId,
        wordEn: 'three-examples',
        translationRu: 'пример-3',
        exampleSentences: [
          { en: 'The first full sample is here.', native: 'Первый полный пример здесь.' },
          { en: 'The second full sample is here.', native: 'Второй полный пример здесь.' },
          { en: 'The third full sample is here.', native: 'Третий полный пример здесь.' },
        ] as any,
      },
    });

    const count = await countWordsNeedingSentences();
    expect(count - beforeCount).toBe(3);

    const rows = await findWordsNeedingSentences(10);
    const ids = rows.map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining([withNull.id, withOne.id, withTwo.id]));
    expect(ids).not.toContain(withThree.id);
  });

  it('does not remove sentence when only 2 remain', async () => {
    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'stable-pool',
        translationRu: 'стабильный-пул',
        sentenceIndex: 1,
        exampleSentences: [
          { en: 'Keep the first sample stable.', native: 'Сохрани первый пример.' },
          { en: 'Keep the second sample stable.', native: 'Сохрани второй пример.' },
        ] as any,
      },
    });

    const result = await removeSentenceAtIndex(word.id, 0);
    expect(result.removed).toBe(false);
    expect(result.sentences).toHaveLength(2);

    const fresh = await prisma.word.findUnique({ where: { id: word.id } });
    const stored = (fresh?.exampleSentences ?? []) as any[];
    expect(stored).toHaveLength(2);
    expect(fresh?.sentenceIndex).toBe(1);
  });

  it('removes sentence when pool has 3 and re-normalizes index', async () => {
    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'shrink-pool',
        translationRu: 'уменьшить-пул',
        sentenceIndex: 2,
        exampleSentences: [
          { en: 'First pool item stays.', native: 'Первый элемент остаётся.' },
          { en: 'Second pool item will be removed.', native: 'Второй элемент удаляется.' },
          { en: 'Third pool item stays.', native: 'Третий элемент остаётся.' },
        ] as any,
      },
    });

    const result = await removeSentenceAtIndex(word.id, 1);
    expect(result.removed).toBe(true);
    expect(result.sentences).toHaveLength(2);

    const fresh = await prisma.word.findUnique({ where: { id: word.id } });
    const stored = (fresh?.exampleSentences ?? []) as any[];
    expect(stored).toHaveLength(2);
    expect(fresh?.sentenceIndex).toBe(0);
  });

  it('appendSentences tops up pool without replacing existing entries', async () => {
    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'top-up-pool',
        translationRu: 'дополнить-пул',
        sentenceIndex: 0,
        exampleSentences: [
          { en: 'Keep this first sentence.', native: 'Оставь это первое предложение.' },
          { en: 'Keep this second sentence.', native: 'Оставь это второе предложение.' },
        ] as any,
      },
    });

    await appendSentences(
      word.id,
      [{ en: 'Add this missing third sentence.', native: 'Добавь недостающее третье предложение.' }] as any,
      3
    );

    const fresh = await prisma.word.findUnique({ where: { id: word.id } });
    const stored = (fresh?.exampleSentences ?? []) as any[];
    expect(stored).toHaveLength(3);
    expect(stored[0]?.en).toBe('Keep this first sentence.');
    expect(stored[1]?.en).toBe('Keep this second sentence.');
    expect(stored[2]?.en).toBe('Add this missing third sentence.');
  });

  it('ignores malformed exampleSentences when advancing sentence index', async () => {
    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'broken-pool',
        translationRu: 'slomannyi-pul',
        sentenceIndex: 5,
        exampleSentences: { broken: true } as any,
      },
    });

    await expect(advanceSentenceIndex(word.id)).resolves.toBeUndefined();

    const fresh = await prisma.word.findUnique({ where: { id: word.id } });
    expect(fresh?.sentenceIndex).toBe(5);
  });

  it('returns null for malformed exampleSentences in review flow', () => {
    const result = getSentenceForReview({
      exampleSentences: { broken: true },
      sentenceIndex: 0,
    });

    expect(result).toBeNull();
  });
});
