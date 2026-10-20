import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Скользящее окно с блокировкой — та же семантика, что у встроенного in-memory хранилища
 * (@nestjs/throttler), но счётчики общие для всех экземпляров API. Скрипт атомарен и берёт
 * время у самого Redis, поэтому расхождение часов серверов не влияет на счёт.
 *
 * KEYS[1] — ZSET попаданий (score = момент истечения), KEYS[2] — признак блокировки.
 * ARGV: ttl (мс), limit, blockDuration (мс), уникальный id попадания.
 * Возвращает { totalHits, timeToExpire (с), isBlocked (0/1), timeToBlockExpire (с) }.
 */
const SCRIPT = `
local hits = KEYS[1]
local blocked = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local member = ARGV[4]

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local function timeToExpire()
  local oldest = redis.call('ZRANGE', hits, 0, 0, 'WITHSCORES')
  if oldest[2] then
    return math.max(1, math.ceil((tonumber(oldest[2]) - now) / 1000))
  end
  return math.ceil(ttl / 1000)
end

local blockedFor = redis.call('PTTL', blocked)
if blockedFor > 0 then
  local seconds = math.ceil(blockedFor / 1000)
  return { limit + 1, seconds, 1, seconds }
end

redis.call('ZREMRANGEBYSCORE', hits, '-inf', now)

if block <= 0 then
  local total = redis.call('ZCARD', hits)
  if total >= limit then
    local seconds = timeToExpire()
    return { total + 1, seconds, 1, seconds }
  end
  redis.call('ZADD', hits, now + ttl, member)
  redis.call('PEXPIRE', hits, ttl)
  return { total + 1, timeToExpire(), 0, 0 }
end

redis.call('ZADD', hits, now + ttl, member)
redis.call('PEXPIRE', hits, ttl)
local total = redis.call('ZCARD', hits)
if total > limit then
  redis.call('SET', blocked, '1', 'PX', block)
  redis.call('DEL', hits)
  local seconds = math.ceil(block / 1000)
  return { total, seconds, 1, seconds }
end
return { total, timeToExpire(), 0, 0 }
`;

/** Запись состояния лимитера (тот же формат, что у ThrottlerStorage из @nestjs/throttler). */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/** Пока Redis недоступен, не обращаемся к нему столько мс (счёт идёт в запасном хранилище). */
const BACKOFF_MS = 5000;

type ScriptCommand = (
  hitsKey: string,
  blockKey: string,
  ttl: number,
  limit: number,
  block: number,
  member: string,
) => Promise<[number, number, number, number]>;

/**
 * Хранилище счётчиков rate limit в Redis с запасным вариантом: при недоступности Redis
 * счёт временно ведётся в памяти процесса (защита от перебора работает, но не общая),
 * а запросы пользователей не падают.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly run: ScriptCommand;
  private downUntil = 0;

  constructor(
    private readonly redis: Redis,
    private readonly fallback: ThrottlerStorage,
  ) {
    redis.defineCommand('throttleIncrement', { numberOfKeys: 2, lua: SCRIPT });
    this.run = (
      redis as unknown as { throttleIncrement: ScriptCommand }
    ).throttleIncrement.bind(redis);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (Date.now() < this.downUntil) {
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
    try {
      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] =
        await this.run(
          `throttle:${throttlerName}:${key}:hits`,
          `throttle:${throttlerName}:${key}:blocked`,
          ttl,
          limit,
          blockDuration,
          randomUUID(),
        );
      return {
        totalHits,
        timeToExpire,
        isBlocked: isBlocked === 1,
        timeToBlockExpire,
      };
    } catch (err) {
      if (this.downUntil === 0 || Date.now() >= this.downUntil) {
        this.logger.warn(
          `Redis rate limit storage failed, using in-memory counters for ${BACKOFF_MS / 1000}s: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      this.downUntil = Date.now() + BACKOFF_MS;
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }
}
