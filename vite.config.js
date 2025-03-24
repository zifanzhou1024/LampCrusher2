import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
    base: '/LampCrusher2/',
    server: {
        port: 3000
    },
    build: {
        assetsDir: 'assets',
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html')
            }
        }
    },
    publicDir: 'public'
})