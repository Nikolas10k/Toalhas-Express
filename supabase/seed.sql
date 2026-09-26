-- Seed de DESENVOLVIMENTO (executado apenas por `supabase db reset` no ambiente
-- local). Nunca aplicar em staging/produção. Usuários são criados pelo
-- scripts/bootstrap.mjs, pois dependem do Supabase Auth.
do $$
begin
  if not exists (select 1 from public.organizations where slug = 'toalhas-express-dev') then
    perform app.bootstrap_organization('Toalhas Express (dev)', 'toalhas-express-dev');
  end if;
end
$$;
