/**
 * BaseRepository — thin typed wrapper around the pg Pool.
 *
 * Provides:
 *   - query<T>       — returns all matching rows as T[]
 *   - queryOne<T>    — returns the first matching row or null
 *   - transaction<T> — runs a callback inside a BEGIN / COMMIT block;
 *                      automatically rolls back on error
 *
 * IMPORTANT: always use parameterised queries ($1, $2, …) and pass values via
 * the `params` array. Never interpolate user-supplied data directly into SQL.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool as defaultPool } from './client';

export class BaseRepository {
  protected readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? defaultPool;
  }

  // ---------------------------------------------------------------------------
  // Core query helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute a parameterised SQL statement and return all rows as T[].
   *
   * @example
   * const users = await repo.query<User>(
   *   'SELECT * FROM users WHERE role = $1',
   *   ['student']
   * );
   */
  async query<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result: QueryResult<T> = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Execute a parameterised SQL statement and return the first row, or null
   * if no rows were returned.
   *
   * @example
   * const user = await repo.queryOne<User>(
   *   'SELECT * FROM users WHERE id = $1',
   *   [userId]
   * );
   */
  async queryOne<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const result: QueryResult<T> = await this.pool.query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  /**
   * Execute a SQL statement using an already-acquired PoolClient (for use
   * inside transactions).  Returns all rows as T[].
   */
  async queryWithClient<T extends QueryResultRow = Record<string, unknown>>(
    client: PoolClient,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result: QueryResult<T> = await client.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Execute a SQL statement using an already-acquired PoolClient and return
   * the first row, or null.
   */
  async queryOneWithClient<T extends QueryResultRow = Record<string, unknown>>(
    client: PoolClient,
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const result: QueryResult<T> = await client.query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Transaction support
  // ---------------------------------------------------------------------------

  /**
   * Run `fn` inside a database transaction.
   *
   * - Acquires a client from the pool.
   * - Calls BEGIN before invoking `fn`.
   * - Calls COMMIT if `fn` resolves successfully.
   * - Calls ROLLBACK if `fn` throws, then re-throws the error.
   * - Always releases the client back to the pool.
   *
   * @example
   * const result = await repo.transaction(async (client) => {
   *   const app = await repo.queryOneWithClient<Application>(
   *     client,
   *     'INSERT INTO applications (...) VALUES (...) RETURNING *',
   *     [...]
   *   );
   *   await repo.queryWithClient(
   *     client,
   *     'INSERT INTO notifications (...) VALUES (...)',
   *     [...]
   *   );
   *   return app;
   * });
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
