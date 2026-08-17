import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/tests-vnext/**/*.test.ts'],
    globals: true,
    environment: 'node',
    outputFile: undefined,
    silent: false,
    logHeapUsage: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
