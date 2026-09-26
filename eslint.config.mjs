import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'coverage/**', 'next-env.d.ts']),
  {
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Componentes e páginas nunca acessam o banco nem serviços privilegiados diretamente.
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/server/db/*', '**/server/db/*'], message: 'Componentes não acessam o banco. Use um service.' },
            { group: ['**/repository', '**/*.repository'], message: 'Componentes não acessam repositórios. Use um service.' },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
]);
