# 2.1.13 → 自制RSS 3.0

本仓库承接原「股票判断机」项目，3.0 正式改为 RSS 本机阅读器。

保留的升级基础：Android applicationId `com.baibiaowang.stockjudge`、旧版固定 release signing、原生 APK SHA-256 校验与 FileProvider 安装、Android 返回键、本机数据优先思路。

新的产品主体：订阅 / 收藏 / 点评 / 设置；支持 RSS、Atom、JSON Feed；文章本机归档；删除订阅源不删除已经保存的文章。

当前版本：3.0.7（versionCode 3007）。

注意：订阅地址由用户在 App 设置中输入。包含访问 token 的 RSS 地址不要提交到公开仓库。
