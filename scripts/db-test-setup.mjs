#!/usr/bin/env node
// Recria o banco de testes: shim do Supabase + todas as migrations em ordem.
// Uso: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/toalhas_test node scripts/db-test-setup.mjs
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/toalhas_test';
const target = new URL(url);
const dbName = target.pathname.replace(/^\//, '');
if (!/^[a-z0-9_]+_test$/.test(dbName)) {
  console.error(`Recusado: o banco de testes deve terminar em "_test" (recebido "${dbName}").`);
  process.exit(1);
}

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
await admin.unsafe(`create database "${dbName}"`);
await admin.end();

const sql = postgres(url, { max: 1, onnotice: () => {} });
const root = path.resolve(import.meta.dirname, '..');
await sql.unsafe(await readFile(path.join(root, 'supabase/tests/supabase_shim.sql'), 'utf8'));

const migrationsDir = path.join(root, 'supabase/migrations');
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  const content = await readFile(path.join(migrationsDir, file), 'utf8');
  try {
    await sql.begin((tx) => tx.unsafe(content));
  } catch (err) {
    console.error(`Falha na migration ${file}:`, err.message);
    await sql.end();
    process.exit(1);
  }
  console.log(`✔ ${file}`);
}
await sql.end();
console.log(`Banco ${dbName} pronto.`);
