# Sofa Read

面向 Android 和 iOS 的离线电子书阅读器，使用 React 和 Capacitor，另有 Electron 桌面入口。

## 阅读与书架

- 通过系统文件选择器导入 EPUB、PDF、TXT、FB2、FBZ、FB2.ZIP、MOBI、AZW、AZW3 和 CBZ。书架只保存原文件引用，支持原文件移动后的重新定位。
- 书架支持自建分类，按导入时间或书名首字母排序。中文书名按拼音排序。阅读记录显示最近五本书，最近在读的一本放在顶部，可直接继续。
- 读取原书目录。纯文本识别中文章回、英文章节和 Markdown 标题。没有目录时按章节、正文分段或 PDF 页码提供入口。
- 记录阅读位置，支持添加书签及编写、编辑和跳转笔记。书架和阅读数据保存在本机。
- 提供主题、自定义背景、阅读区亮度、行距、12–48 px 字号与字体设置。内置 Lato、阿里巴巴普惠体和阿里妈妈数黑体，也可载入本机字体。
- 支持滚动和翻页。翻页可通过轻点左右侧操作。Android 可开启音量键翻页。iOS 设置中隐藏该项。章节名、电量与时间可以分别关闭。

PDF 使用文档页码。可重排电子书使用按内容长度估算的位置，页脚以「约」标识。PDF 与固定版式电子书保留原始排版。受数字版权保护的 Kindle 文件需要其授权阅读器。阅读超时会让阅读区进入黑屏并恢复系统自动息屏，实际锁屏时刻由系统设置决定。

## 本地运行

需要 Node.js 22.12 或更新版本。

```sh
npm ci
npm run dev
```

### Android

需要 JDK 21、Android SDK 36。最低 Android 7.0，建议更新 Android System WebView。

```sh
npm run android:debug
```

调试 APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。如果本机已有 Gradle 8.13，可以用 `GRADLE_BIN` 指定其可执行文件的绝对路径。

### iOS

需要 macOS 和支持 Capacitor 8 的 Xcode。应用部署目标为 iOS 16.4 或更新版本。

```sh
npm run ios:open
```

在 Xcode 中选择模拟器或真机并运行。真机安装需要在 Xcode 中设置签名团队。

## 本地验证

```sh
npm run typecheck
npm test
npm run test:smoke
SOFA_TEST_CHROME='/本机/Chrome/可执行文件' npm run test:mobile
```

桌面冒烟测试使用临时用户目录，通过真实 Electron 窗口测试文件导入、分类排序、目录、续读、标注和重新定位。可设置 `SOFA_TEST_AZW` 与 `SOFA_TEST_AZW3` 指定自备的无 DRM 测试书。移动界面冒烟测试在手机尺寸下使用模拟的原生文件接口，验证触屏界面和平台设置。原生文件选择、音量键和系统息屏行为需在各平台真机上检查。

阅读解析使用 [Foliate.js](https://github.com/johnfactotum/foliate-js) 和 [PDF.js](https://mozilla.github.io/pdf.js/)。字体按各自授权使用，参见 [Lato](https://www.latofonts.com/)、[阿里巴巴字体库](https://fonts.alibabagroup.com/)。
