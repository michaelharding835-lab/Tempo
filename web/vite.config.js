import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build` -> web/dist, served by the FastAPI app (and Vercel's CDN).
// `npm run build:preview` -> one self-contained HTML file with sample data, for previews.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'preview' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'preview' ? 'dist-preview' : 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: mode === 'preview' ? 100_000_000 : 4096,
  },
  server: { proxy: { '/api': 'http://localhost:8765', '/mcp': 'http://localhost:8765' } },
}))
