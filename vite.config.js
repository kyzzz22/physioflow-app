import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // relative paths keep the lightweight web folder portable
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: '',
    emptyOutDir: true,
    cssCodeSplit: false,
  },
});
