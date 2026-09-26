import { afterAll } from 'vitest';
import postgres from 'postgres';
import { setSqlForTesting } from '@/server/db/client';

process.env.LOG_LEVEL = 'error';
process.env.APP_HASH_PEPPER ??= 'test-pepper-test-pepper-test-pepper-0000';
const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/toalhas_test';
process.env.DATABASE_URL = url;

export const testSql = postgres(url, { max: 10, onnotice: () => {} });
setSqlForTesting(testSql);

afterAll(async () => {
  await testSql.end({ timeout: 5 });
  setSqlForTesting(undefined);
});
