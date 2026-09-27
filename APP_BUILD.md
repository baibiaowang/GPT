# 自制RSS Android 构建

## 版本身份
- App 名称：自制RSS
- versionName：3.0.8
- versionCode：3008
- applicationId：com.baibiaowang.stockjudge

## Android 工程

正式 Android 工程位于仓库的 `android/` 目录。构建前会同步 `mobile-web` 到 Capacitor 工程，并把 `native/MainActivity.java` 和图标/Manifest 补丁应用到工程。

## 原生能力

- RSS/Atom/JSON Feed 原生 HTTPS 读取，避免 WebView CORS 限制。
- RSS 内容采用 Base64 字节分块回传，JavaScript 按 UTF-8 字节偏移读取，避免中文截断。
- 原文 URL 调起系统浏览器。
- APK 更新下载支持 HTTPS 重定向、缓存破除、文件大小校验、SHA-256 校验和 FileProvider 安装。
- Android 系统返回键按 WebView 页面层级处理。

## 正式发布链

正式发布由 `baibiaowang/GPT/.github/workflows/release-rss-v3.yml` 完成。流程使用本仓库当前源码和旧版兼容签名，在发布前后都进行验证：

1. 校验 package.json、app.js、Android 工程的版本身份。
2. 构建 release APK，并检查签名证书与旧版升级链一致。
3. 计算 APK 文件大小和 SHA-256。
4. 发布到 GPT 的版本化 `apk/releases/<version>/app.apk`。
5. 创建版本化 GitHub Release 资产 `zizhi-rss-<version>.apk`。
6. 从 Raw 和 Release 两个实际下载地址重新下载 APK，核对大小和 SHA-256。
7. 只有验证通过后才生成并发布兼容 `update.json`。
8. 最后再从公开 `update.json` 下载 APK，进行一次最终大小/SHA-256 校验。

因此，更新清单不会再把一个版本号对应到不同 APK 字节的可变地址。
