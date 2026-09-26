#!/usr/bin/env node
// Garante que nenhum segredo de servidor chegou ao bundle do navegador.
// Rode após `next build`. Em CI o build usa valores-sentinela nas variáveis
// secretas; se qualquer um aparecer em .next/static, o check falha.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const staticDir = path.join(root, '.next', 'static');

const SECRET_ENV = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'CRON_SECRET',
  'APP_HASH_PEPPER',
  'N8N_OUTBOX_HMAC_SECRET',
  'ASAAS_API_KEY',
  'ASAAS_WEBHOOK_TOKEN',
  'GOOGLE_MAPS_SERVER_KEY',
];

// Valores reais (ou sentinelas) presentes no ambiente do build.
const needles = SECRET_ENV.map((name) => [name, process.env[name]])
  .filter(([, v]) => typeof v === 'string' && v.length >= 8)
  .map(([name, value]) => ({ label: `valor de ${name}`, value }));

// Nomes que nunca deveriam ser referenciados por código client.
for (const name of SECRET_ENV) needles.push({ label: `referência a ${name}`, value: name });
// Chaves secretas do Supabase têm prefixo conhecido.
needles.push({ label: 'chave secreta Supabase', value: 'sb_secret_' });

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|css|html|json|map)$/.test(entry.name)) yield full;
  }
}

let files = 0;
const findings = [];
try {
  for await (const file of walk(staticDir)) {
    files += 1;
    const content = await readFile(file, 'utf8');
    for (const { label, value } of needles) {
      if (content.includes(value)) findings.push(`${path.relative(root, file)}: ${label}`);
    }
  }
} catch (err) {
  console.error(`Não foi possível ler ${staticDir}. Rode "next build" antes. (${err.message})`);
  process.exit(1);
}

if (files === 0) {
  console.error('Nenhum arquivo em .next/static — build ausente?');
  process.exit(1);
}
if (findings.length > 0) {
  console.error('❌ Segredos encontrados no bundle do navegador:');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✔ ${files} arquivos do bundle client verificados; nenhum segredo encontrado (${needles.length} padrões).`);
