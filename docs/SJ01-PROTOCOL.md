# SJ01 数据协议

本项目只处理数据端已经生成的 SJ01 密文，不负责生产端加密。

## 两个独立版本号

SJ01 外层版本与解密后的 JSON schema 版本是两个不同概念，不能互相推断：

- **SJ01 envelope version**：密文二进制第 5 个字节（offset 4）。
- **JSON schema**：AES-GCM 解密后的 JSON 中 `meta.schema`。

当前线上数据经过 GitHub Actions 实测为 `SJ01` + envelope version `0x03`。

历史 `stock-judge-app/data/000586.txt` 样本曾出现 `SJ01` + envelope version `0x01`，其提交说明仍称其为 schema-3 数据。因此 envelope version 与 JSON schema 必须分开处理。

## 当前 App 解密协议

```
Base64 text
  -> Base64 decode
  -> [4B magic][1B envelope version][12B IV][ciphertext || 16B GCM tag]
  -> AES-256-GCM
  -> UTF-8 JSON
  -> meta.schema === 3
```

- key：用户输入的 64 位十六进制字符串，转换为 32 字节 AES-256 key
- IV：12 字节，offset 5..16
- authentication tag：最后 16 字节
- AAD：当前实现未使用
- plaintext：UTF-8 JSON
- 核心 JSON：`meta.schema=3`、`layout.list_columns`、`layout.detail_columns`、`records[]`
- `display`、`judge_tables`、`announcements` 是可选扩展，存在时才校验对象类型。

## CI 校验

CI 先做无需密钥的 SJ01 envelope 检查；如果 Actions 中配置了 `AES_KEY` Secret，再继续做完整 AES-256-GCM 解密与 schema-3 校验。没有配置 Secret 时，“该步骤成功”只表示安全跳过，不代表已经完成明文解密。

## 安全

激活码不得写入源码、HTML、Git 历史或明文配置。App 运行时从本地设置读取用户输入的 64 位十六进制密钥。
