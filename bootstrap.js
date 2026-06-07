/**
 * Bootstrap script — loads .env synchronously before ts-node starts.
 * This guarantees USE_REDIS_MOCK and all other env vars are set
 * before any TypeScript module is evaluated.
 *
 * Usage: node -r ./bootstrap.js -r ts-node/register src/server.ts
 */
require('dotenv').config();
