# Sofa Read 本地验证

日期为 2026-11-09，时区为上海。

| 验收项 | 本地结果 |
| --- | --- |
| 类型检查与单元测试 | `npm run typecheck` 通过。三个纯文本和格式检测用例通过。 |
| 阅读格式与业务流程 | Electron 冒烟通过。覆盖 EPUB、PDF、TXT、FBZ，以及 libmobi 提供的 MOBI 6 与 KF8 样本。验证了书架分类、拼音排序、最近五本、PDF 实际页码、笔记和书签、重启续读、原文件移动后重新定位。 |
| 移动界面 | 手机尺寸触屏冒烟通过。验证了通过原生接口导入的界面路径、两平台设置项差异、电量、系统字体与页面宽度。 |
| Android 原生工程 | JDK 21、SDK 36、Gradle 8.13 构建通过。APK 包名为 `com.sofazhu.sofaread`，最低系统 API 24。当前没有连接真机或模拟器。 |
| iOS 原生工程 | Swift 语法检查与 Xcode 工程、应用配置文件校验通过。当前只有命令行开发工具，未执行 Xcode 原生编译或真机验证。 |

技术维度 88 分，战略维度 90 分，综合 89 分。代码复用已有阅读引擎，原文件引用、平台差异和阅读位置均有覆盖。建议在完成移动端真机验证后用于正式发布。后续验证优先覆盖 Android 文档权限跨重启、物理音量键和 iOS 文件书签跨重启与 PDF 阅读。

构建、验证命令与适配边界见项目说明。无 DRM 样本来源为 [libmobi 测试目录](https://github.com/bfabiszewski/libmobi/tree/public/tests/samples)。
