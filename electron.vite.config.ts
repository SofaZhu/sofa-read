import { defineConfig } from 'electron-vite'
import { cpSync } from 'node:fs'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    base: './',
    build: {
      target: 'safari16.4',
      rolldownOptions: {
        output: {
          // iOS 16 的本地 WebView 对 .js 文件有明确的模块 MIME 映射。
          assetFileNames: asset => asset.names.some(name => name.endsWith('.mjs'))
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]'
        }
      }
    },
    optimizeDeps: { exclude: ['@ray-d-song/foliate-js'] },
    plugins: [{
      name: '电子书页面布局保护',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('/@ray-d-song/foliate-js/paginator.js')) return
        // iframe 切换正文时，ResizeObserver 可能先于新文档的 body 触发。
        return code.replace('if (!this.#view) return\n        this.#view.render(', 'if (!this.#view?.document?.body) return\n        this.#view.render(')
      }
    }, {
      name: 'pdf-离线资源',
      closeBundle() {
        for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
          cpSync(`node_modules/pdfjs-dist/${name}`, `out/renderer/pdf/${name}`, { recursive: true })
        }
      }
    }],
    server: {
      fs: { allow: ['../..'] }
    }
  }
})
