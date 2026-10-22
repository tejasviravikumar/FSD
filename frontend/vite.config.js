
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // GitHub Pages repository path

  // Keep React and React DOM on one instance
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
