import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Две страницы: приложение для клиентов и отдельная панель управления (/admin/)
export default defineConfig({
  plugins: [react()],
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
