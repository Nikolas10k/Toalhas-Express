import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * E2E contra o build de produção (`next start`). Sem Supabase real, cobre
 * headers de segurança, redirecionamentos de auth, CSRF e validação.
 * Fluxos com login real rodam em staging (ver docs/RUNBOOK.md).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_URL: baseURL,
      APP_ENV: 'development',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/toalhas_test',
      CRON_SECRET: process.env.CRON_SECRET ?? 'e2e-cron-secret-e2e-cron-secret-e2e-cron-secret',
      APP_HASH_PEPPER: process.env.APP_HASH_PEPPER ?? 'e2e-pepper-e2e-pepper-e2e-pepper-e2e-pepper',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_build_placeholder_key',
      LOG_LEVEL: 'error',
    },
  },
});
