import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Номер сборки: коммит на Vercel, иначе время сборки. Панель сверяет его с /version.json и предлагает обновиться.
const BUILD = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || String(Date.now())
const versionFile = (): Plugin => ({
  name: 'nex-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD, at: new Date().toISOString() }) })
  },
})

// Две страницы: приложение для клиентов и отдельная панель управления (/admin/)
export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD) },
  build: {
    // Шрифты всегда отдельными файлами: CSP разрешает шрифты только со своего домена (font-src 'self')
    assetsInlineLimit: (file) => (file.endsWith('.woff2') || file.endsWith('.woff') ? false : undefined),
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
})
