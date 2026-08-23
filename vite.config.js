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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
