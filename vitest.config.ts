import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // `server-only` lança erro fora do bundler do Next; nos testes é um módulo vazio.
    alias: { 'server-only': path.resolve(import.meta.dirname, 'tests/setup/empty-module.ts') },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/unit.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/integration.ts'],
          globalSetup: ['tests/setup/integration-global.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
