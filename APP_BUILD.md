# 自制 RSS 阅读器 3.0.12

## 身份
- versionName：3.0.12
- versionCode：3012
- applicationId：com.baibiaowang.stockjudge（仅用于覆盖升级已有安装包）
- 数字签名继续使用现有 release signing

## 数据
- IndexedDB：zizhi-rss-reader
- stores：sources、articles
- article 主键：guid
- 已读、收藏、点评全部绑定 guid
- 不读取旧版业务数据库数据

## Feed
- 标准 RSS 2.0 /feed
- 支持 agu-ann-feed token、category、begin、end
- pubDate 作为更新时间
- guid 作为唯一去重键
- 行情为空时正常显示“未取到”

## Android
- 原生 HTTPS 抓取避免 WebView CORS
- Feed 与更新清单采用本地临时文件 + Base64 分块读取
- APK 自动跟随 HTTPS 重定向
- APK 大小与 SHA-256 双重校验
- FileProvider 调起系统安装
- 系统返回键按页面层级处理

## 发布
.github/workflows/release-rss.yml 自动构建、签名、发布 Release、发布 apk 镜像并生成 update.json。
