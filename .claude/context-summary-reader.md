# 阅读器实现上下文

参考同级项目的 `package.json`、`vitest.config.ts`、`tests/typography.test.tsx`，沿用 TypeScript、React、Vitest 和两空格缩进。阅读引擎参考 Foliate 的 `view.js`、`reader.js` 与 `paginator.js`，PDF 使用 PDF.js 的阅读器。

集成路径为 Electron 主进程 → 预加载接口 → React 阅读界面 → 按格式分流到 Foliate 或 PDF.js。阅读位置与标注由本地存储保存。闲置管理和音量键由 Electron 提供。验收包含导入后重新启动、翻页与定位、主题及设置持久化、损坏文件恢复。

用户将项目定位更新为移动端，增加 Android 和 iOS 原生入口，并要求保留原文件。书架改用 Android 持久文档授权、iOS 文件书签与 Electron 本地路径注册。阅读进度、分类、笔记和书签由渲染端本地存储。Android 注册前台音量键，iOS 直接隐藏音量键选项。
