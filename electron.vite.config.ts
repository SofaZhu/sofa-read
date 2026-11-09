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
        // 章节起点 CFI 只有章节路径，没有正文锚点。
        const restoreChapterStart = (source: string) => source.replace(
          'const anchor = doc => CFI.toRange(doc, parts)',
          'const anchor = parts.length || parts.start ? doc => CFI.toRange(doc, parts) : 0')
        if (id.endsWith('/@ray-d-song/foliate-js/epub.js')) return restoreChapterStart(code)
        if (id.endsWith('/@ray-d-song/foliate-js/view.js')) {
          const marker = 'if (this.isFixedLayout) {'
          if (!code.includes(marker)) throw new Error('电子书引擎的渲染接口已变更。')
          return restoreChapterStart(code).replace(marker, 'if (this.sofaCreateRenderer) { this.renderer = this.sofaCreateRenderer() } else ' + marker)
        }
        if (!id.endsWith('/@ray-d-song/foliate-js/paginator.js')) return
        // 应用统一处理轻点和边缘返回，分页引擎只负责排版与定位。
        const touchStart = code.indexOf('        const opts = { passive: false }')
        const touchEnd = code.indexOf("        this.addEventListener('relocate'", touchStart)
        if (touchStart < 0 || touchEnd < 0) throw new Error('电子书引擎的触摸接口已变更。')
        // iframe 切换正文时，ResizeObserver 可能先于新文档的 body 触发。
        return (code.slice(0, touchStart) + code.slice(touchEnd))
          .replace('if (!this.#view) return\n        this.#view.render(', 'if (!this.#view?.document?.body) return\n        this.#view.render(')
          .replace('requestAnimationFrame(() =>\n            this.#background.style.background = getBackground(this.#view.document))',
            'requestAnimationFrame(() => { if (this.#view?.document?.body) this.#background.style.background = getBackground(this.#view.document) })')
          .replace('then(() => this.#view.expand())', 'then(() => this.#view?.expand())')
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
