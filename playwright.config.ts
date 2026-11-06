import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    { command: 'pnpm --filter @billing/api dev', url: 'http://127.0.0.1:3001/api/v1/health' },
    { command: 'pnpm --filter @billing/web dev', url: 'http://localhost:5173' },
  ],
});
