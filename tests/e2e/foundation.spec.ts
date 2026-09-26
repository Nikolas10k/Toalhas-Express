import { expect, test } from '@playwright/test';

test.describe('segurança HTTP', () => {
  test('páginas têm CSP com nonce e headers de segurança', async ({ request }) => {
    const res = await request.get('/login');
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain("object-src 'none'");
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('microphone=()');
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('API não expõe CORS aberto e não faz cache', async ({ request }) => {
    const res = await request.get('/api/me');
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    expect(res.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('autenticação', () => {
  test('áreas protegidas redirecionam para o login preservando o destino', async ({ page }) => {
    for (const path of ['/admin', '/admin/administracao/auditoria', '/portal', '/motorista']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%2F/g, '(%2F|/)')}`));
    }
  });

  test('tela de login é acessível e valida campos no cliente', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveAttribute('aria-invalid', 'true');
  });

  test('APIs autenticadas retornam 401 sem sessão, sem stack trace', async ({ request }) => {
    const res = await request.get('/api/admin/audit-logs');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(JSON.stringify(body)).not.toMatch(/at .*\.(js|ts):\d+/);
    expect(res.headers()['x-request-id']).toBeTruthy();
  });

  test('worker exige segredo do cron', async ({ request }) => {
    expect((await request.get('/api/internal/jobs/run')).status()).toBe(401);
    const wrong = await request.get('/api/internal/jobs/run', { headers: { authorization: 'Bearer errado' } });
    expect(wrong.status()).toBe(401);
  });
});

test.describe('CSRF e validação', () => {
  test('POST de outra origem é rejeitado', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      data: { email: 'a@b.com', password: 'x' },
    });
    expect(res.status()).toBe(403);
  });

  test('campos extras são rejeitados (mass assignment)', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/login', {
      headers: { origin: baseURL!, 'content-type': 'application/json' },
      data: { email: 'a@b.com', password: 'x', role: 'ADMIN' },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  test('body acima do limite é rejeitado', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/login', {
      headers: { origin: baseURL!, 'content-type': 'application/json' },
      data: { email: 'a@b.com', password: 'x'.repeat(10_000) },
    });
    expect(res.status()).toBe(422);
  });

  test('parâmetro next não permite open redirect', async ({ request }) => {
    const html = await (await request.get('/login?next=//evil.example/x')).text();
    // O formulário recebe o destino já saneado ("/"); o valor externo nunca vira prop de navegação.
    expect(html).toMatch(/\\"next\\":\\"\/\\"/);
    expect(html).not.toMatch(/\\"next\\":\\"\/\/evil/);
  });
});

test('health check responde sem detalhes internos', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.data.status).toMatch(/ok|degraded/);
  expect(Object.keys(body.data).sort()).toEqual(['database', 'status']);
});

test.describe('Fase 2 — clientes', () => {
  test('APIs de clientes exigem autenticação', async ({ request, baseURL }) => {
    for (const path of ['/api/admin/customers', '/api/admin/customer-imports', '/api/portal/customer', '/api/admin/organization/settings']) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
    const post = await request.post('/api/admin/customers', {
      headers: { origin: baseURL!, 'content-type': 'application/json' },
      data: { personType: 'PJ', legalName: 'X', document: '11222333000181' },
    });
    expect(post.status()).toBe(401);
  });

  test('ID inválido na rota vira 401/404, nunca 500', async ({ request }) => {
    const res = await request.get('/api/admin/customers/nao-e-uuid');
    expect([401, 404]).toContain(res.status());
  });

  test('páginas de clientes redirecionam para o login', async ({ page }) => {
    await page.goto('/admin/clientes/importar');
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test('cadastro público mostra indisponível quando desligado', async ({ page }) => {
    await page.goto('/cadastro');
    await expect(page.getByRole('heading', { name: 'Seja cliente' })).toBeVisible();
    await expect(page.getByText('não está disponível')).toBeVisible();
  });

  test('auto cadastro valida campos antes de enviar', async ({ request, baseURL }) => {
    const res = await request.post('/api/public/signup', {
      headers: { origin: baseURL!, 'content-type': 'application/json' },
      data: { personType: 'PJ', legalName: 'A', document: '123', email: 'x', password: '1', acceptTerms: false },
    });
    expect(res.status()).toBe(422);
  });
});

test.describe('Fase 3 — estoque', () => {
  test('APIs de estoque exigem autenticação', async ({ request }) => {
    for (const path of ['/api/admin/products', '/api/admin/inventory/overview', '/api/admin/inventory/movements', '/api/portal/balances']) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
  });

  test('páginas de estoque redirecionam para o login', async ({ page }) => {
    await page.goto('/admin/estoque/movimentacoes');
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});
