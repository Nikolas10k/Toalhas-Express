import 'server-only';
import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let sqlInstance: Sql | undefined;

/**
 * Conexão única por instância (serverless). `prepare: false` é obrigatório com
 * o pooler em modo transação (Supavisor). A URL vem só do ambiente do servidor.
 */
export function getSql(): Sql {
  if (sqlInstance) return sqlInstance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada.');
  sqlInstance = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: 'toalhas-express' },
  });
  return sqlInstance;
}

/** Apenas para testes de integração. */
export function setSqlForTesting(sql: Sql | undefined): void {
  sqlInstance = sql;
}
