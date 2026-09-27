# 自制RSS 3.x · GPT 单仓库

现在 baibiaowang/GPT 是自制RSS的唯一代码仓库。原 baibiaowang/RSS 的 3.x 应用源码将迁入本仓库，后续开发、构建、发布与更新清单均以 GPT 为准。

当前版本：自制RSS 3.0.8，versionCode 3008，applicationId com.baibiaowang.stockjudge。

支持 RSS、Atom、JSON Feed；文章、正文、摘要、股票字段以及本地收藏/点评保存到 IndexedDB。

Android 使用原生 HTTPS 抓取，支持重定向、响应 charset 转 UTF-8 和 Base64 字节分块回传；解析器兼容标准 Feed 以及常见的 entries/articles/data 数组。
