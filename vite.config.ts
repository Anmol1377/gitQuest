import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site from /gitQuest/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/gitQuest/' : '/',
  plugins: [react()],
})
