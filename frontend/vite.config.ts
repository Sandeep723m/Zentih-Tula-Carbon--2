import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Bundles go to /static, not the default /assets: public/Assets (logos) would otherwise share one folder
  // on macOS, where names ignore case, and be split apart on the Linux server.
  build: { assetsDir: 'static' },
})
