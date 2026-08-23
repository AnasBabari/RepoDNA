import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts', 'app/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    server: {
      deps: {
        inline: ['next-auth', '@auth/core'],
      },
    },
  },
  resolve: {
    alias: {
      'next/server': 'next/server.js',
      '@': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
});
