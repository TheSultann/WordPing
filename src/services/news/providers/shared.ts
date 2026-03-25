import { trimEnv } from '../../../utils/env';
import type { Prisma } from '../../../generated/prisma/client';
import { normalizeWordForMatch } from '../utils';

export const isEnglishLike = (value: string | undefined): boolean => {
    const normalized = trimEnv(value).toLowerCase();
    if (!normalized) return true;
    return normalized.startsWith('en') || normalized === 'english';
};

export const createContainsFilter = (
    field: 'title' | 'snippet' | 'bodyText' | 'url',
    term: string,
): Prisma.NewsCacheWhereInput => ({ [field]: { contains: term, mode: 'insensitive' } } as Prisma.NewsCacheWhereInput);

export const withWordCandidates = (
    terms: string[],
    fields: Array<'title' | 'snippet' | 'bodyText'>,
): Prisma.NewsCacheWhereInput[] => {
    const uniqueTerms = Array.from(new Set(terms.map((term) => normalizeWordForMatch(term)).filter(Boolean)));
    return uniqueTerms.flatMap((term) => fields.map((field) => createContainsFilter(field, term)));
};
