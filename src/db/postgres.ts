import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

/** Anything that can run a query: the pool itself or a checked-out client. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

export interface PostgresOptions {
  connectionString: string;
  max: number;
  ssl: boolean;
}

export function createPool({ connectionString, max, ssl }: PostgresOptions): Pool {
  return new Pool({
    connectionString,
    max,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Runs `work` inside a single transaction. Commits on success, rolls back on
 * any thrown error and always releases the client back to the pool.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
