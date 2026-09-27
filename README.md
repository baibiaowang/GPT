# 自制 RSS 阅读器

baibiaowang/GPT 是自制 RSS 阅读器唯一代码仓库。

当前版本：3.0.12 / versionCode 3012

项目按 RSS 阅读器重新实现，专用对接 agu-ann-feed。客户端不再依赖股票判断机的数据表、判断规则或旧数据库。

## 功能
- RSS 2.0 公告流
- 分类自动发现
- 标题、股票、分类、AI 总结搜索
- guid 去重
- 已读、收藏、个人点评
- 公告详情与 PDF 原文外跳
- 本机 JSON 备份与恢复
- Android 原生 HTTPS 抓取
- APK SHA-256 校验与固定数字签名
- GitHub Actions 自动构建、发布与更新清单

## agu-ann-feed
默认服务地址：https://agu-ann-feed.app.workbuddy.host/feed
首次使用在设置中填写 Feed URL 和 Token；分类可留空，也可填写服务端支持的 category。
公开仓库不保存访问 Token。

## Android 升级身份
applicationId 保持 com.baibiaowang.stockjudge，仅作为已有 APK 的 Android 安装身份；数字签名继续沿用。业务代码已经重新实现为 RSS 阅读器。

## 构建
npm install
npm run build:apk

正式发布由 .github/workflows/release-rss.yml 完成。
