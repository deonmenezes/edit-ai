import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Vitest runs without the Cloudflare plugin from vite.config.ts: that plugin validates the
 * worker environment and rejects the `resolve.external` list Vitest sets on the ssr
 * environment, which fails the run before any test loads. Component tests do not need the
 * worker runtime, so they get this smaller config instead.
 */
export default defineConfig({
  plugins: [tailwindcss(), viteReact()],
  resolve: { alias: { '#': new URL('./src/', import.meta.url).pathname } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
