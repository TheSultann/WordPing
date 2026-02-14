import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    threads: false,
    fileParallelism: false,
    hookTimeout: 30000,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'web/src/**/*.ts'],
      exclude: ['src/generated/**', '**/*.d.ts'],
    },
  },
});
