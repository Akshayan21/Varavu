import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['apps/**/*.test.ts','tests/database/**/*.test.ts'] } });
