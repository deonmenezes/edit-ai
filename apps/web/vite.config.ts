import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const TRUEFORGE_URL = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      // The browser talks to TrueForge through the dev server so no CORS setup is needed.
      '/tf': { target: TRUEFORGE_URL, changeOrigin: true, rewrite: (path) => path.replace(/^\/tf/, '') },
    },
  },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
