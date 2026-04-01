import { prisma } from '../../../db/client';
import type { ProviderName, ProviderPermitRules, ProviderPermit } from '../types';
import { nextUtcDayStart, utcDayStart } from '../utils';

export const providerReason = (provider: ProviderName, suffix: string): string =>
    `${provider.toLowerCase()}_${suffix}`;

export const ensureProviderState = async (
    provider: ProviderName,
    now: Date,
): Promise<{
    dayStartUtc: Date;
    requestsToday: number;
    lastRequestAt: Date | null;
    cooldownUntil: Date | null;
}> => {
    const dayStartUtc = utcDayStart(now);
    const created = await prisma.newsProviderState.upsert({
        where: { provider },
        create: {
            provider,
            dayStartUtc,
            requestsToday: 0,
            lastRequestAt: null,
            cooldownUntil: null,
            lastStatusCode: null,
            lastError: null,
        },
        update: {},
        select: {
            dayStartUtc: true,
            requestsToday: true,
            lastRequestAt: true,
            cooldownUntil: true,
        },
    });

    if (created.dayStartUtc.getTime() < dayStartUtc.getTime()) {
        const reset = await prisma.newsProviderState.update({
            where: { provider },
            data: {
                dayStartUtc,
                requestsToday: 0,
            },
            select: {
                dayStartUtc: true,
                requestsToday: true,
                lastRequestAt: true,
                cooldownUntil: true,
            },
        });
        return reset;
    }

    return created;
};

export const acquireProviderPermit = async (
    provider: ProviderName,
    rules: ProviderPermitRules = {},
): Promise<ProviderPermit> => {
    const now = new Date();
    const state = await ensureProviderState(provider, now);
    const providerPrefix = provider.toLowerCase();

    if (state.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()) {
        return {
            allowed: false,
            retryAt: state.cooldownUntil,
            reason: `${providerPrefix}_cooldown`,
        };
    }

    if (rules.minIntervalSeconds && state.lastRequestAt) {
        const retryAt = new Date(state.lastRequestAt.getTime() + rules.minIntervalSeconds * 1000);
        if (retryAt.getTime() > now.getTime()) {
            return {
                allowed: false,
                retryAt,
                reason: `${providerPrefix}_rate_limited`,
            };
        }
    }

    const hardLimit = rules.dailyLimit ?? Number.MAX_SAFE_INTEGER;
    const softBudget = rules.dailyBudget ?? Number.MAX_SAFE_INTEGER;
    const maxDaily = Math.min(hardLimit, softBudget);
    if (state.requestsToday >= maxDaily) {
        return {
            allowed: false,
            retryAt: nextUtcDayStart(now),
            reason: `${providerPrefix}_quota_exhausted`,
        };
    }

    await prisma.newsProviderState.update({
        where: { provider },
        data: {
            lastRequestAt: now,
            requestsToday: { increment: 1 },
        },
    });

    return { allowed: true };
};

export const markProviderSuccess = async (provider: ProviderName, statusCode: number): Promise<void> => {
    const now = new Date();
    await ensureProviderState(provider, now);
    await prisma.newsProviderState.update({
        where: { provider },
        data: {
            lastStatusCode: statusCode,
            lastError: null,
            cooldownUntil: null,
        },
    });
};

export const markProviderFailure = async (
    provider: ProviderName,
    statusCode: number | null,
    error: string,
    cooldownMinutes?: number,
): Promise<Date | null> => {
    const now = new Date();
    await ensureProviderState(provider, now);
    const cooldownUntil = cooldownMinutes ? new Date(now.getTime() + cooldownMinutes * 60_000) : null;
    await prisma.newsProviderState.update({
        where: { provider },
        data: {
            lastStatusCode: statusCode,
            lastError: error.slice(0, 512),
            cooldownUntil,
        },
    });
    return cooldownUntil;
};
