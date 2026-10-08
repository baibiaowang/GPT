# 自制RSS 阅读器

> **用途**：把 agu-ann-feed 产出的 A股公告 RSS，做成一个装在手机上的原生 App。
> 订阅源、分类、搜索、已读收藏、离线备份、应用内升级全在本机完成，不依赖任何第三方服务。
>
> **状态**：线上生产。当前版本 **3.0.19**（versionCode 3019），APK 通过 GitHub Release 对外分发。
>
> **配套仓库**：
> [A-share-announcement-summary](https://github.com/baibiaowang/A-share-announcement-summary)（另一套公告系统 agu-v3，**与本 App 无关**）。
> 本 App 对接的 agu-ann-feed 服务是**独立部署**，其源码仓已于 2026-10-08 删除，
> 线上实例仍在运行（见下方「订阅源」）。
>
> **快速开始**：装 APK 见[「安装与升级」](#安装与升级)；改代码出包见[「本地构建」](#本地构建)；
> 发布流程见[「自动发布」](#自动发布)。

## 功能

- RSS 2.0 公告流（专为 agu-ann-feed 的输出格式做了兼容，同时也吃标准 RSS 2.0）
- 分类自动发现与筛选
- 按标题 / 股票 / 分类 / AI 总结搜索
- guid 去重，已读、收藏、个人点评
- 公告详情页与 PDF 原文外跳
- 本机 JSON 备份与恢复
- Android 原生 HTTPS 抓取（绕过 WebView 的跨域限制）
- APK SHA-256 校验 + 固定数字签名
- 应用内检查更新（读 `update.json` 清单，校验大小与 SHA-256 后再装）

## 订阅源

默认服务地址：

```
https://agu-ann-feed.app.workbuddy.host/feed
```

首次使用在 App 的「设置 → 添加订阅源」里填 Feed URL 和 Token；分类可留空，
也可填服务端支持的 `category`。**公开仓库不保存任何访问 Token。**

## 安装与升级

两个下载地址（内容一致，任选其一）：

```
https://raw.githubusercontent.com/baibiaowang/GPT/apk/releases/<版本>/app.apk
https://github.com/baibiaowang/GPT/releases/download/v<版本>/zizhi-rss-<版本>.apk
```

例如当前版本：

```
https://github.com/baibiaowang/GPT/releases/download/v3.0.19/zizhi-rss-3.0.19.apk
```

- `apk` 分支按版本号归档历史 APK；GitHub Release 提供同名附件。
- App 内「设置 → 检查新版本」读根目录的 [`update.json`](update.json)，
  校验通过后自动下载安装。

### 签名与升级身份

- `applicationId` 固定为 `com.baibiaowang.stockjudge`，数字签名沿用同一把固定密钥——
  **这两个是 Android 的升级身份，不能改**，改了就无法覆盖安装。
- 签名材料以 base64 存在仓库 Actions secrets（`ANDROID_KEYSTORE_BASE64`、
  `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`）。
  **GitHub secret 只写不可读，请务必在本机另存一份密钥备份**，丢失后将无法再发布可覆盖安装的版本。
- 构建流程会拿新包证书摘要与历史版本（v2.1.13 / v2.1.7 / v2.1.6）逐一比对，
  签名链断了会直接构建失败。

## 本地构建

```bash
npm install
npm run build:apk
```

`build:apk` 会依次跑：自检 → 注入移动端页面 → 准备 Android 工程 → 打补丁
（Manifest / 版本号 / 图标）→ `cap sync` → `gradle assembleRelease`。
产物在 `android/app/build/outputs/apk/release/app-release.apk`。

本地出正式包需要先准备好签名文件并设置上表四个环境变量，否则 release 构建会失败
（**已移除 debug 签名回退**，缺配置不会静默产出无法覆盖安装的包）。

## 自动发布

推送 `main`（改动 `app.js` / `index.html` / `styles.css` / `manifest.json` / `sw.js` /
`package.json` / `capacitor.config.json` / `native/**` / `scripts/**` / `assets/**` /
工作流本身）或手动触发 `.github/workflows/release-rss.yml`，工作流会：

1. 校验 `package.json` 的 `version` / `versionCode` 与 `app.js` 里的
   `APP_VERSION` / `APP_VERSION_CODE` 一致，且 `appId` 正确；
2. 还原签名材料并构建 release APK；
3. `apksigner` 校验签名，并与历史版本比对证书摘要；
4. 把 APK 推到 `apk` 分支、创建或刷新对应 Release；
5. 验证两个下载地址可访问且 SHA-256 一致；
6. 生成并发布 `update.json` 更新清单（同版本字节不一致会拒绝覆盖）。

发布是幂等的：同版本重复跑不会覆盖已发布的字节。

## 目录

```
app.js                  全部业务逻辑（单文件）
index.html styles.css   页面与样式
manifest.json sw.js     PWA 清单与 Service Worker
capacitor.config.json   Capacitor 配置（appId / webDir）
native/                 Android 原生桥接（MainActivity / 注入与打补丁脚本）
scripts/                构建前处理与自检
assets/                 图标等静态资源
update.json             应用内升级清单（由工作流生成）
APP_BUILD.md            构建细节补充说明
```

## 版本历史

- **3.0.19** — 修复添加订阅源页面返回与系统返回键
- **3.0.18** — 紧凑 RSS 卡片与独立添加订阅页
- **3.0.17** — 标准 App 底部固定导航
- **3.0.16** — 修复 Android 底部导航悬空

完整历史见 [Releases](https://github.com/baibiaowang/GPT/releases)。
