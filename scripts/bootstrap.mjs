#!/usr/bin/env node
// Cria (ou reaproveita) uma organização e convida o primeiro ADMIN.
// Idempotente: pode ser executado de novo sem duplicar nada.
//
// Uso:
//   node --env-file=.env.local scripts/bootstrap.mjs \
//     --org-name "Toalhas Express" --org-slug toalhas-express \
//     --admin-email admin@empresa.com.br --admin-name "Nome do Admin"
//
// Requer: DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL.
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const { values } = parseArgs({
  options: {
    'org-name': { type: 'string' },
    'org-slug': { type: 'string' },
    'admin-email': { type: 'string' },
    'admin-name': { type: 'string' },
  },
});

for (const k of ['org-name', 'org-slug', 'admin-email']) {
  if (!values[k]) {
    console.error(`Parâmetro obrigatório ausente: --${k}`);
    process.exit(1);
  }
}
for (const k of ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL']) {
  if (!process.env[k]) {
    console.error(`Variável de ambiente ausente: ${k}`);
    process.exit(1);
  }
}

const email = values['admin-email'].trim().toLowerCase();
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  // 1) Organização
  let [org] = await sql`select id from public.organizations where slug = ${values['org-slug']}`;
  if (!org) {
    [org] = await sql`select app.bootstrap_organization(${values['org-name']}, ${values['org-slug']}) as id`;
    console.log(`✔ Organização criada: ${org.id}`);
  } else {
    console.log(`• Organização já existe: ${org.id}`);
  }

  // 2) Usuário no Supabase Auth (convite por e-mail para definir a senha)
  let [user] = await sql`select id from auth.users where lower(email) = ${email}`;
  if (!user) {
    const redirectTo = new URL('/auth/confirm?next=/redefinir-senha', process.env.APP_URL).toString();
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) throw new Error(`Falha ao convidar usuário: ${error.message}`);
    user = { id: data.user.id };
    console.log(`✔ Convite enviado para ${email}`);
  } else {
    console.log(`• Usuário já existe no Auth: ${user.id}`);
  }

  // 3) Perfil, vínculo e role ADMIN (transação única, com auditoria)
  await sql.begin(async (tx) => {
    await tx`
      insert into public.profiles (id, full_name) values (${user.id}, ${values['admin-name'] ?? null})
      on conflict (id) do nothing
    `;
    const [member] = await tx`
      insert into public.organization_members (organization_id, user_id, status, mfa_required)
      values (${org.id}, ${user.id}, 'active', true)
      on conflict (organization_id, user_id) do update set status = 'active'
      returning id
    `;
    await tx`
      insert into public.member_roles (organization_id, member_id, role_id)
      select ${org.id}, ${member.id}, r.id from public.roles r where r.organization_id = ${org.id} and r.code = 'ADMIN'
      on conflict do nothing
    `;
    await tx`
      insert into public.audit_logs (id, organization_id, actor_type, action, entity_type, entity_id, after, metadata)
      values (${randomUUID()}, ${org.id}, 'SYSTEM', 'member.bootstrapped_admin', 'organization_member', ${member.id},
              ${tx.json({ user_id: user.id, roles: ['ADMIN'] })}, ${tx.json({ source: 'scripts/bootstrap.mjs' })})
    `;
  });
  console.log('✔ Administrador vinculado com role ADMIN (MFA obrigatório no primeiro acesso).');
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
