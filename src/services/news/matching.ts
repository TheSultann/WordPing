import {
    NewsCacheCandidate,
    FieldMatch,
    Tier1MatchProfile,
    Tier1ScoredCandidate,
    ResolvedNewsExample,
    NewsExampleTier,
} from './types';
import {
    normalizeWordForMatch,
    extractTokens,
    buildTokenForms,
    buildStrictWordForms,
    buildWordForms,
    normalizeText,
    escapeRegex,
    escapeHtml,
} from './utils';
import { readRssTokenCoverageMin, readRssMatchMinScore } from './config';

export const buildWordRegex = (value: string, flags: string = 'iu'): RegExp => {
    const escaped = escapeRegex(value).replace(/\s+/g, '\\s+');
    return new RegExp(`\\b${escaped}\\b`, flags);
};

type MatchMode = 'strict' | 'soft';

export const containsAnyForm = (text: string, forms: string[]): boolean => {
    const normalizedText = normalizeWordForMatch(text);
    if (!normalizedText) return false;
    for (const form of forms) {
        const normalizedForm = normalizeWordForMatch(form);
        if (!normalizedForm) continue;
        if (buildWordRegex(normalizedForm).test(normalizedText)) {
            return true;
        }
    }
    return false;
};

export const findMatchedForm = (text: string, forms: string[]): string | null => {
    const normalizedText = normalizeWordForMatch(text);
    if (!normalizedText) return null;
    for (const form of forms) {
        const normalizedForm = normalizeWordForMatch(form);
        if (!normalizedForm) continue;
        const match = normalizedText.match(buildWordRegex(normalizedForm));
        if (match?.[0]) return match[0];
    }
    return null;
};

export const matchesPhraseOrTokens = (
    text: string,
    phrase: string,
    tokens: string[],
): { phraseHit: boolean; tokenCoverage: number } => {
    const normalizedText = normalizeWordForMatch(text);
    if (!normalizedText) return { phraseHit: false, tokenCoverage: 0 };

    const normalizedPhrase = normalizeWordForMatch(phrase);
    const uniqueTokens = Array.from(new Set(tokens.map((item) => normalizeWordForMatch(item)).filter(Boolean)));

    const phraseHit = normalizedPhrase ? buildWordRegex(normalizedPhrase).test(normalizedText) : false;
    if (!uniqueTokens.length) {
        return { phraseHit, tokenCoverage: 0 };
    }

    let matched = 0;
    for (const token of uniqueTokens) {
        if (buildWordRegex(token).test(normalizedText)) {
            matched += 1;
        }
    }

    return {
        phraseHit,
        tokenCoverage: matched / uniqueTokens.length,
    };
};

export const containsWord = (text: string, wordEn: string): boolean => {
    const forms = buildWordForms(wordEn);
    return containsAnyForm(text, forms);
};

const hasMeaningfulSnippetLength = (text: string): boolean => {
    const wordsCount = text.split(/\s+/).filter(Boolean).length;
    return text.length >= 40 && wordsCount >= 5;
};

const findFirstMatchInText = (text: string, forms: string[]): { index: number } | null => {
    let best: { index: number } | null = null;

    for (const form of forms) {
        const normalizedForm = normalizeWordForMatch(form);
        if (!normalizedForm) continue;

        const regex = buildWordRegex(normalizedForm, 'iu');
        const match = regex.exec(text);
        if (!match || typeof match.index !== 'number') continue;

        if (!best || match.index < best.index) {
            best = { index: match.index };
        }
    }

    return best;
};

const sliceAroundMatch = (text: string, forms: string[], maxChars: number): string | null => {
    const normalized = normalizeText(text, 6000);
    if (!normalized) return null;
    if (normalized.length <= maxChars) return normalized;

    const first = findFirstMatchInText(normalized, forms);
    if (!first) {
        return normalized.slice(0, maxChars).trim();
    }

    const leading = Math.floor(maxChars * 0.35);
    let start = Math.max(0, first.index - leading);
    let end = Math.min(normalized.length, start + maxChars);
    if (end - start < maxChars) {
        start = Math.max(0, end - maxChars);
    }
    return normalized.slice(start, end).trim();
};

const splitIntoSentences = (text: string): string[] =>
    (text.match(/[^.!?\n]+[.!?]?/g) ?? [text])
        .map((part) => part.trim())
        .filter(Boolean);

const sentenceMatchesProfile = (text: string, profile: Tier1MatchProfile): boolean => {
    if (profile.isMultiWord) {
        const phraseTokens = matchesPhraseOrTokens(text, profile.phrase, profile.tokens);
        return phraseTokens.phraseHit || phraseTokens.tokenCoverage >= profile.minTokenCoverage;
    }
    return containsAnyForm(text, profile.forms);
};

const extractMatchedSnippet = (
    text: string | null | undefined,
    profile: Tier1MatchProfile,
    maxChars: number,
): string | null => {
    const normalized = normalizeText(text, 6000);
    if (!normalized) return null;

    const sentenceWithMatch = splitIntoSentences(normalized).find((sentence) =>
        sentenceMatchesProfile(sentence, profile),
    );
    const fromSentence = sliceAroundMatch(sentenceWithMatch ?? normalized, profile.forms, maxChars);
    if (!fromSentence) return null;

    if (containsAnyForm(fromSentence, profile.forms)) {
        return fromSentence;
    }

    return sliceAroundMatch(normalized, profile.forms, maxChars);
};

export const highlightWord = (text: string, wordEn: string): string => {
    const base = text.trim();
    if (!base) return '';

    const word = wordEn.trim();
    if (!word) return escapeHtml(base);

    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'giu');
    let lastIndex = 0;
    let highlighted = '';

    for (const match of base.matchAll(regex)) {
        const index = match.index ?? 0;
        const chunk = match[0] ?? '';
        highlighted += escapeHtml(base.slice(lastIndex, index));
        highlighted += `<u><b>${escapeHtml(chunk.toUpperCase())}</b></u>`;
        lastIndex = index + chunk.length;
    }

    if (lastIndex === 0) {
        return escapeHtml(base);
    }

    highlighted += escapeHtml(base.slice(lastIndex));
    return highlighted;
};

export const buildTier1Profile = (wordEn: string): Tier1MatchProfile => {
    const normalizedWord = normalizeWordForMatch(wordEn);
    const tokens = extractTokens(normalizedWord);
    const isMultiWord = tokens.length > 1;
    const tokenForms = buildTokenForms(tokens);
    const strictForms = isMultiWord
        ? Array.from(new Set([normalizedWord, ...tokenForms]))
        : buildStrictWordForms(normalizedWord);
    const forms = isMultiWord
        ? strictForms
        : buildWordForms(normalizedWord);

    const dbTerms = Array.from(new Set([normalizedWord, ...strictForms, ...forms, ...tokens]))
        .map((item) => item.trim())
        .filter((item) => item.length >= 2);

    return {
        rawWord: wordEn,
        normalizedWord,
        tokens,
        strictForms,
        forms,
        phrase: normalizedWord,
        isMultiWord,
        minTokenCoverage: readRssTokenCoverageMin(),
        minScore: readRssMatchMinScore(),
        dbTerms,
    };
};

export const evaluateFieldMatch = (text: string | null | undefined, profile: Tier1MatchProfile): FieldMatch => {
    const normalized = normalizeText(text, 6000);
    if (!normalized) {
        return { exactForm: false, softForm: false, phraseHit: false, tokenCoverage: 0 };
    }
    const phraseTokens = matchesPhraseOrTokens(normalized, profile.phrase, profile.tokens);
    return {
        exactForm: containsAnyForm(normalized, profile.strictForms),
        softForm: containsAnyForm(normalized, profile.forms),
        phraseHit: phraseTokens.phraseHit,
        tokenCoverage: phraseTokens.tokenCoverage,
    };
};

export const freshnessBonus = (item: NewsCacheCandidate, now: Date): number => {
    const reference = item.publishedAt ?? item.fetchedAt;
    const ageHours = (now.getTime() - reference.getTime()) / 3_600_000;
    if (ageHours <= 24) return 20;
    if (ageHours <= 72) return 12;
    return 4;
};

export const pickCandidateText = (
    item: NewsCacheCandidate,
    profile: Tier1MatchProfile,
    titleMatch: FieldMatch,
    snippetMatch: FieldMatch,
    bodyMatch: FieldMatch,
    mode: MatchMode,
): { text: string | null; matchedWord: string | null } => {
    const fieldList: Array<{ name: 'snippet' | 'title' | 'bodyText'; text: string | null; match: FieldMatch }> = [
        { name: 'snippet', text: item.snippet, match: snippetMatch },
        { name: 'bodyText', text: item.bodyText, match: bodyMatch },
        { name: 'title', text: item.title, match: titleMatch },
    ];
    const activeForms = mode === 'strict' ? profile.strictForms : profile.forms;

    for (const field of fieldList) {
        const matched = profile.isMultiWord
            ? field.match.phraseHit || field.match.tokenCoverage >= profile.minTokenCoverage
            : (mode === 'strict' ? field.match.exactForm : field.match.softForm);
        if (!matched) continue;

        const snippet = extractMatchedSnippet(field.text, profile, 420);
        if (!snippet) continue;

        // Keep min-length guard for snippet/body text, but allow short matched titles as final fallback.
        if (field.name !== 'title' && !hasMeaningfulSnippetLength(snippet)) continue;

        return {
            text: snippet,
            matchedWord: findMatchedForm(snippet, activeForms)
                ?? findMatchedForm(normalizeText(field.text, 6000) ?? '', activeForms)
                ?? profile.rawWord,
        };
    }

    return { text: null, matchedWord: null };
};

export const scoreCandidate = (
    item: NewsCacheCandidate,
    profile: Tier1MatchProfile,
    now: Date,
): Tier1ScoredCandidate | null => {
    const titleMatch = evaluateFieldMatch(item.title, profile);
    const snippetMatch = evaluateFieldMatch(item.snippet, profile);
    const bodyMatch = evaluateFieldMatch(item.bodyText, profile);

    const anyPhraseHit = titleMatch.phraseHit || snippetMatch.phraseHit || bodyMatch.phraseHit;
    const tokenCoverage = Math.max(titleMatch.tokenCoverage, snippetMatch.tokenCoverage, bodyMatch.tokenCoverage);
    const anyExactForm = titleMatch.exactForm || snippetMatch.exactForm || bodyMatch.exactForm;
    const anySoftForm = titleMatch.softForm || snippetMatch.softForm || bodyMatch.softForm;

    const scoreByMode = (mode: MatchMode): Tier1ScoredCandidate | null => {
        if (profile.isMultiWord) {
            if (!anyPhraseHit && tokenCoverage < profile.minTokenCoverage) {
                return null;
            }
        } else if (mode === 'strict') {
            if (!anyExactForm) return null;
        } else if (!anySoftForm) {
            return null;
        }

        let score = 0;
        if (mode === 'strict') {
            if (titleMatch.exactForm) score += 100;
            if (snippetMatch.exactForm) score += 60;
            if (bodyMatch.exactForm) score += 35;
        } else {
            if (titleMatch.softForm) score += 70;
            if (snippetMatch.softForm) score += 45;
            if (bodyMatch.softForm) score += 25;
            // Soft pass is a fallback: keep it lower priority than exact match.
            score -= 10;
        }

        if (titleMatch.phraseHit) score += 40;
        if (snippetMatch.phraseHit) score += 25;

        if (profile.isMultiWord) {
            score += Math.round(Math.max(0, Math.min(1, tokenCoverage)) * 20);
        }

        score += freshnessBonus(item, now);

        const minScore = mode === 'strict' ? profile.minScore : profile.minScore + 10;
        if (score < minScore) return null;

        const selected = pickCandidateText(item, profile, titleMatch, snippetMatch, bodyMatch, mode);
        if (!selected.text) return null;

        return {
            item,
            score,
            selectedText: selected.text,
            matchedWord: selected.matchedWord ?? profile.rawWord,
            dateRank: (item.publishedAt ?? item.fetchedAt).getTime(),
        };
    };

    const strictScored = scoreByMode('strict');
    if (strictScored || profile.isMultiWord) {
        return strictScored;
    }

    return scoreByMode('soft');
};

export const selectBestTier1Candidate = (
    rows: NewsCacheCandidate[],
    profile: Tier1MatchProfile,
    now: Date,
): Tier1ScoredCandidate | null => {
    let best: Tier1ScoredCandidate | null = null;

    for (const row of rows) {
        const scored = scoreCandidate(row, profile, now);
        if (!scored) continue;
        if (!best) {
            best = scored;
            continue;
        }
        if (scored.score > best.score) {
            best = scored;
            continue;
        }
        if (scored.score === best.score && scored.dateRank > best.dateRank) {
            best = scored;
        }
    }

    return best;
};

export const selectBestExternalCandidate = (
    wordEn: string,
    tier: NewsExampleTier,
    rows: Array<{
        title: string;
        snippet: string;
        bodyText: string | null;
        url: string;
        publishedAt: Date | null;
    }>,
): ResolvedNewsExample | null => {
    if (!rows.length) return null;
    const now = new Date();
    const profile = buildTier1Profile(wordEn);
    let best: Tier1ScoredCandidate | null = null;

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const scored = scoreCandidate({
            id: index + 1,
            title: row.title,
            snippet: row.snippet,
            bodyText: row.bodyText,
            url: row.url,
            publishedAt: row.publishedAt,
            fetchedAt: now,
        }, profile, now);
        if (!scored) continue;
        if (!best || scored.score > best.score || (scored.score === best.score && scored.dateRank > best.dateRank)) {
            best = scored;
        }
    }

    if (!best) return null;
    return {
        text: best.selectedText,
        tier,
        sourceUrl: best.item.url,
        sourceTitle: best.item.title,
        matchedWord: best.matchedWord,
    };
};
