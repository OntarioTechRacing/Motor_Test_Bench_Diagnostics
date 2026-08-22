import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicData = path.resolve(root, 'public/data')

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      allow: [root, publicData],
    },
  },
})
