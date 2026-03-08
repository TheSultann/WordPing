import { NewsExampleTier } from '../../generated/prisma/client';
export { NewsExampleTier };

export type NewsDigestItem = {
    wordId: number;
    wordEn: string;
    translation: string | null;
    highlightedText: string;
    tier: NewsExampleTier;
    sourceUrl: string | null;
    sourceTitle: string | null;
};

export type NewsCacheCandidate = {
    id: number;
    title: string;
    snippet: string;
    bodyText: string | null;
    url: string;
    publishedAt: Date | null;
    fetchedAt: Date;
};

export type FieldMatch = {
    exactForm: boolean;
    softForm: boolean;
    phraseHit: boolean;
    tokenCoverage: number;
};

export type Tier1MatchProfile = {
    rawWord: string;
    normalizedWord: string;
    tokens: string[];
    strictForms: string[];
    forms: string[];
    phrase: string;
    isMultiWord: boolean;
    minTokenCoverage: number;
    minScore: number;
    dbTerms: string[];
};

export type Tier1ScoredCandidate = {
    item: NewsCacheCandidate;
    score: number;
    selectedText: string;
    matchedWord: string;
    dateRank: number;
};

export type ResolvedNewsExample = {
    text: string;
    tier: NewsExampleTier;
    sourceUrl: string | null;
    sourceTitle: string | null;
    matchedWord: string;
};

export type RssNormalizedItem = {
    source: string;
    title: string;
    url: string;
    snippet: string;
    bodyText: string | null;
    language: string | null;
    publishedAt: Date | null;
};

export type GdeltArticle = {
    title?: string;
    url?: string;
    language?: string;
    domain?: string;
    socialimage?: string;
    excerpt?: string;
    description?: string;
    snippet?: string;
};

export type GdeltResponse = {
    articles?: GdeltArticle[];
};

export type GdeltScope = 'uzbekistan' | 'international';

export type NewsDataArticle = {
    title?: string;
    link?: string;
    description?: string;
    content?: string;
    language?: string;
    source_id?: string;
};

export type NewsDataResponse = {
    status?: string;
    code?: string;
    message?: string;
    results?: NewsDataArticle[];
};

export type GuardianApiResult = {
    webTitle?: string;
    webUrl?: string;
    fields?: {
        trailText?: string;
    };
};

export type GuardianApiResponse = {
    response?: {
        status?: string;
        results?: GuardianApiResult[];
    };
};

export type FetchResult = {
    ok: boolean;
    status: number;
    text: string;
};

export type ProviderName = 'NEWSDATA' | 'GDELT' | 'GUARDIAN';

export type ProviderPermitRules = {
    minIntervalSeconds?: number;
    dailyLimit?: number;
    dailyBudget?: number;
};

export type ProviderPermit = {
    allowed: boolean;
    retryAt?: Date;
    reason?: string;
};

export type TierLookupResult = {
    example: ResolvedNewsExample | null;
    deferredUntil?: Date | undefined;
    deferredReason?: string | undefined;
};

export type ResolveOutcome = {
    resolved: ResolvedNewsExample | null;
    deferredUntil?: Date | undefined;
    deferredReason?: string | undefined;
};

export type ResolvePendingNewsExamplesResult = {
    claimed: number;
    resolved: number;
    failed: number;
    deferred: number;
    durationMs: number;
};

export type RefreshNewsCacheResult = {
    inserted: number;
    updated: number;
    totalProcessed: number;
};
