import 'express-serve-static-core';
import type { TelegramUser } from './auth';

declare module 'express-serve-static-core' {
  interface Request {
    telegramUser?: TelegramUser;
    telegramUserId?: bigint;
  }
}

export {};

