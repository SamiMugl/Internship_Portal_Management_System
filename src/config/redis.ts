/**
 * Shared Redis client.
 *
 * Uses ioredis-mock (in-memory) when:
 *   - NODE_ENV=test
 *   - USE_REDIS_MOCK=true  (set this in .env for local dev without Redis)
 *
 * Otherwise connects to the real Redis server defined by REDIS_URL.
 *
 * Key-namespace prefixes:
 *   lockout:        — account lockout TTL keys
 *   blacklist:      — refresh-token blacklist keys
 *   cache:listings: — listing search result cache
 */

import { env } from './env';

const useMock =
  process.env.NODE_ENV === 'test' ||
  process.env.USE_REDIS_MOCK === 'true';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RedisClass = useMock ? require('ioredis-mock') : require('ioredis');

function createRedisClient() {
  if (useMock) {
    const client = new RedisClass();
    console.log('[redis] Using in-memory Redis mock (no Redis server required).');
    return client;
  }

  const client = new RedisClass(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: false,
  });

  client.on('error', (err: Error) => {
    console.error('[redis] Connection error:', err.message);
  });

  client.on('connect', () => {
    console.log('[redis] Connected to Redis server.');
  });

  return client;
}

export const redis = createRedisClient();
