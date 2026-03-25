import { inspect } from 'node:util';
import { trimEnv } from './env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'pretty' | 'json';
export type LogContext = Record<string, unknown>;

export type Logger = {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  child: (context: LogContext) => Logger;
};

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);
const LOG_FORMATS = new Set<LogFormat>(['pretty', 'json']);

const readLogLevel = (): LogLevel => {
  const raw = trimEnv(process.env.LOG_LEVEL).toLowerCase();
  if (LOG_LEVELS.has(raw as LogLevel)) {
    return raw as LogLevel;
  }
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
};

const readLogFormat = (): LogFormat => {
  const raw = trimEnv(process.env.LOG_FORMAT).toLowerCase();
  if (LOG_FORMATS.has(raw as LogFormat)) {
    return raw as LogFormat;
  }
  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
};

const serializeUnknown = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const serialized: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    if (value.stack) {
      serialized.stack = value.stack;
    }
    if ('cause' in value && value.cause !== undefined) {
      const cause = serializeUnknown(value.cause, seen);
      if (cause !== undefined) {
        serialized.cause = cause;
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      const next = serializeUnknown(entry, seen);
      if (next !== undefined) {
        serialized[key] = next;
      }
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeUnknown(entry, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const serialized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const next = serializeUnknown(entry, seen);
      if (next !== undefined) {
        serialized[key] = next;
      }
    }
    return serialized;
  }
  return inspect(value, { depth: 4, breakLength: Infinity });
};

const normalizeContext = (context: LogContext = {}): LogContext => {
  const serialized = serializeUnknown(context);
  if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
    return {};
  }
  return serialized as LogContext;
};

const resolveConsoleMethod = (level: LogLevel): ((message?: unknown, ...optionalParams: unknown[]) => void) => {
  if (level === 'warn') return console.warn.bind(console);
  if (level === 'error') return console.error.bind(console);
  return console.log.bind(console);
};

export const createLogger = (service: string, baseContext: LogContext = {}): Logger => {
  const minLevel = readLogLevel();
  const format = readLogFormat();
  const normalizedBaseContext = normalizeContext(baseContext);

  const write = (level: LogLevel, message: string, context?: LogContext): void => {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[minLevel]) return;

    const mergedContext = normalizeContext({
      ...normalizedBaseContext,
      ...(context ?? {}),
    });

    const time = new Date().toISOString();
    const record: {
      time: string;
      level: LogLevel;
      service: string;
      pid: number;
      msg: string;
      context?: LogContext;
    } = {
      time,
      level,
      service,
      pid: process.pid,
      msg: message,
    };

    if (Object.keys(mergedContext).length > 0) {
      record.context = mergedContext;
    }

    if (format === 'json') {
      resolveConsoleMethod(level)(JSON.stringify(record));
      return;
    }

    if (Object.keys(mergedContext).length > 0) {
      resolveConsoleMethod(level)(message, {
        time,
        service,
        ...mergedContext,
      });
      return;
    }

    resolveConsoleMethod(level)(message);
  };

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
    child: (context) => createLogger(service, { ...normalizedBaseContext, ...normalizeContext(context) }),
  };
};
