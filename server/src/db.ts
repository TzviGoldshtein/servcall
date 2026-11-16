import pg from 'pg';
import { config } from './config.ts';

// תאריכים ומספרים גדולים חוזרים כמחרוזות כברירת מחדל; מיישרים את זה פעם אחת.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
};

export const db: Db = {
  query: (sql, params) => pool.query(sql, params as never[]),
  async tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const scoped: Db = {
        query: (sql, params) => client.query(sql, params as never[]),
        tx: (inner) => inner(scoped),
      };
      const out = await fn(scoped);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
