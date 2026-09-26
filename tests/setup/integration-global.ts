import { execFileSync } from 'node:child_process';

/** Recria o banco de testes (shim Supabase + migrations) uma vez por execução. */
export default function setup() {
  process.env.TEST_DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/toalhas_test';
  execFileSync('node', ['scripts/db-test-setup.mjs'], { stdio: 'inherit', env: process.env });
}
