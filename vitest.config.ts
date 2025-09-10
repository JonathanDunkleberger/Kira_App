import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsxInject: "import React from 'react'",
  },
  test: {
    environment: 'jsdom',
    globals: true,
  setupFiles: ['./__tests__/setup.ts'],
    include: ['{app,components,lib}/**/*.test.{ts,tsx}'],
  },
});
