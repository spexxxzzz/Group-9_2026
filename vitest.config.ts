import { defineConfig } from 'vitest/config'

// Unit tests exercise pure application logic, not the Cloudflare Worker.
// Keeping this separate from vite.config.ts avoids starting a Worker runtime.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
