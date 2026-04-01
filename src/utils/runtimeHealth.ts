import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type RuntimeHealthService = 'api' | 'bot' | 'worker' | 'news-worker';
export type RuntimeHealthState = 'ok' | 'error';
export type RuntimeHealthStatus = 'ok' | 'missing' | 'stale' | 'error';

type RuntimeHeartbeatPayload = {
  service: RuntimeHealthService;
  pid: number;
  startedAt: string;
  updatedAt: string;
  state: RuntimeHealthState;
  note?: string;
  lastTask?: {
    name: string;
    at: string;
    status: RuntimeHealthState;
    note?: string;
  };
};

export type RuntimeHealthSnapshot = RuntimeHeartbeatPayload & {
  status: RuntimeHealthStatus;
  stale: boolean;
};

type RuntimeReadinessOptions = {
  allowFreshError?: boolean;
};

const HEALTH_DIR = path.join(process.cwd(), '.runtime', 'health');
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_STALE_MS = 90_000;
const ALL_SERVICES: RuntimeHealthService[] = ['api', 'bot', 'worker', 'news-worker'];
const persistQueues = new Map<RuntimeHealthService, Promise<void>>();

const heartbeatPath = (service: RuntimeHealthService): string =>
  path.join(HEALTH_DIR, `${service}.json`);

const ensureHealthDir = async (): Promise<void> => {
  await mkdir(HEALTH_DIR, { recursive: true });
};

const buildSnapshotStatus = (
  payload: RuntimeHeartbeatPayload | null,
  nowMs: number,
): RuntimeHealthSnapshot => {
  if (!payload) {
    const now = new Date(nowMs).toISOString();
    return {
      service: 'api',
      pid: 0,
      startedAt: now,
      updatedAt: now,
      state: 'error',
      status: 'missing',
      stale: true,
      note: 'heartbeat not found',
    };
  }

  const updatedAtMs = Number.isFinite(Date.parse(payload.updatedAt))
    ? Date.parse(payload.updatedAt)
    : 0;
  const stale = updatedAtMs <= 0 || nowMs - updatedAtMs > HEARTBEAT_STALE_MS;
  const status: RuntimeHealthStatus =
    payload.state === 'error'
      ? 'error'
      : stale
        ? 'stale'
        : 'ok';

  return {
    ...payload,
    status,
    stale,
  };
};

export const isRuntimeSnapshotReady = (
  snapshot: RuntimeHealthSnapshot,
  options: RuntimeReadinessOptions = {},
): boolean => {
  if (snapshot.status === 'missing' || snapshot.status === 'stale') {
    return false;
  }

  if (snapshot.status === 'error') {
    return options.allowFreshError === true && snapshot.stale !== true;
  }

  return true;
};

export const readRuntimeHealth = async (
  services: RuntimeHealthService[] = ALL_SERVICES,
): Promise<Record<RuntimeHealthService, RuntimeHealthSnapshot>> => {
  const nowMs = Date.now();
  const out = {} as Record<RuntimeHealthService, RuntimeHealthSnapshot>;

  for (const service of services) {
    try {
      const raw = await readFile(heartbeatPath(service), 'utf8');
      const payload = JSON.parse(raw) as RuntimeHeartbeatPayload;
      out[service] = buildSnapshotStatus(payload, nowMs);
    } catch {
      const missing = buildSnapshotStatus(null, nowMs);
      out[service] = { ...missing, service };
    }
  }

  return out;
};

export const createRuntimeHealthReporter = (service: RuntimeHealthService) => {
  const startedAt = new Date().toISOString();
  let timer: NodeJS.Timeout | null = null;
  let state: RuntimeHeartbeatPayload = {
    service,
    pid: process.pid,
    startedAt,
    updatedAt: startedAt,
    state: 'ok',
  };

  const persist = (): Promise<void> => {
    const currentQueue = persistQueues.get(service) ?? Promise.resolve();
    const nextQueue = currentQueue
      .catch(() => {})
      .then(async () => {
        await ensureHealthDir();
        state = {
          ...state,
          updatedAt: new Date().toISOString(),
          pid: process.pid,
        };
        await writeFile(heartbeatPath(service), JSON.stringify(state, null, 2), 'utf8');
      });

    persistQueues.set(service, nextQueue);
    return nextQueue;
  };

  return {
    start(): void {
      if (timer) return;
      void persist();
      timer = setInterval(() => {
        void persist();
      }, HEARTBEAT_INTERVAL_MS);
      timer.unref();
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    markOk(note?: string): void {
      state = {
        ...state,
        state: 'ok',
        ...(note ? { note } : {}),
      };
      void persist();
    },
    markError(note: string): void {
      state = {
        ...state,
        state: 'error',
        note,
      };
      void persist();
    },
    markTask(name: string, status: RuntimeHealthState, note?: string): void {
      state = {
        ...state,
        state: status,
        ...(note ? { note } : {}),
        lastTask: {
          name,
          at: new Date().toISOString(),
          status,
          ...(note ? { note } : {}),
        },
      };
      void persist();
    },
    snapshot(): RuntimeHeartbeatPayload {
      return { ...state };
    },
  };
};
