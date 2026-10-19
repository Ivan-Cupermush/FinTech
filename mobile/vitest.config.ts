import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Тестируем чистую логику приложения — без React Native.
export default defineConfig({
  resolve: { alias: { '@offix/core': path.resolve(__dirname, '../packages/core/src/index.ts') } },
  test: { include: ['test/**/*.test.ts'] },
});
