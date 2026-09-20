/**
 * 构建时把 www/ 里的占位符替换成真实值，产物写到 dist/www/。
 *
 * 用法（在仓库根目录执行）：
 *   AES_KEY=<64位hex> [DATA_URL=<地址,多个用换行分隔>] node native/inject.mjs
 *
 * - AES_KEY  必填，64 位十六进制；不合法直接失败（避免构建出解不开的 apk）
 * - DATA_URL 可选，留空则用内置默认地址列表（jsdelivr + raw）
 *
 * ★ 两个占位符都位于 JS 单引号字符串字面量内（见 www/index.html 顶部
 *   `const DEF_KEY = '__AES_KEY__'` / `const DEF_URLS = '__DATA_URL__'`），
 *   所以替换前必须做 JS 字符串转义。
 *
 * ★ 历史事故一（2026-09-20）：多行地址未转义就替换，字面量里出现裸换行 ->
 *   整个 <script> 报 SyntaxError 解析失败 -> App 打开后页面只剩静态骨架、
 *   ⋯ 按钮和所有交互全无反应；而旧版脚本只查「占位符还在不在」，占位符确实
 *   没了，于是照样输出 ok、退出码 0、APK 正常产出 —— 静默失败。
 *   现在改成：注入后把每个 <script> 块真正解析一遍，解析不过就 exit 1，
 *   并且**校验通过才写盘**。
 *
 * ★ 历史事故二（2026-09-20）：原默认地址第二条是 GitHub Pages
 *   (https://baibiaowang.github.io/stock-judge-app/data/stocks.txt) —— 实测返回
 *   404「There isn't a GitHub Pages site here.」（那个仓库根本没开 Pages）。
 *   也就是说**兜底源从来就是死的**：raw 一旦不通（国内经常），App 两条全废、
 *   直接「加载失败」，而且不报错、没人发现。现已换成 jsdelivr（实测返回真实数据，
 *   仓库 2.7MB 远低于其 50MB 上限）。
 *
 * ★ 历史事故三（2026-09-20）：原实现**就地改写 www/index.html** —— 本地跑一次
 *   就把真密钥写进源文件，忘了 `git checkout` 就会把密钥提交上去。
 *   现在改成复制 www/ -> dist/www/ 再改副本，源文件永不改动；
 *   并且加一条断言：源文件里若已出现真实密钥，直接拒绝构建。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'www';
const OUT = 'dist/www';
const ENTRY = 'index.html';

/* ★ 顺序即优先级：jsdelivr 在国内可达性明显好于 raw */
const DEFAULT_URLS = [
  'https://cdn.jsdelivr.net/gh/baibiaowang/stock-judge-app@main/data/stocks.txt',
  'https://raw.githubusercontent.com/baibiaowang/stock-judge-app/main/data/stocks.txt',
].join('\n');

const key = (process.env.AES_KEY || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(key)) {
  console.error('::error::AES_KEY missing or malformed (need 64 hex chars)');
  process.exit(1);
}

const urls = (process.env.DATA_URL || '').trim() || DEFAULT_URLS;

if (!fs.existsSync(path.join(SRC, ENTRY))) {
  console.error('::error::not found: ' + path.join(SRC, ENTRY));
  process.exit(1);
}

/* ---- 防护：源文件里绝不能出现真实密钥（防止误提交注入后的版本） ---- */
const srcRaw = fs.readFileSync(path.join(SRC, ENTRY), 'utf8');
if (srcRaw.indexOf(key) >= 0) {
  console.error('::error::' + path.join(SRC, ENTRY) + ' already contains the real key');
  console.error('::error::run `git checkout -- ' + path.join(SRC, ENTRY) + '` before building');
  process.exit(1);
}

/** 转义成可安全放进「单引号 JS 字符串字面量」的内容 */
function jsSingleQuote(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/* ---- 复制 www/ -> dist/www/（源文件不动） ---- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

const P = path.join(OUT, ENTRY);

let h = fs.readFileSync(P, 'utf8');
h = h.split('__AES_KEY__').join(jsSingleQuote(key));
h = h.split('__DATA_URL__').join(jsSingleQuote(urls));

if (h.indexOf('__AES_KEY__') >= 0 || h.indexOf('__DATA_URL__') >= 0) {
  console.error('::error::placeholder still present after injection');
  process.exit(1);
}

/* ---- 真校验：把注入后的每个 <script> 块解析一遍（只解析、不执行） ---- */
const blocks = [...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
if (!blocks.length) {
  console.error('::error::no <script> block found in ' + P);
  process.exit(1);
}
for (let i = 0; i < blocks.length; i++) {
  try {
    new Function(blocks[i]);
  } catch (e) {
    console.error(`::error::injected JS failed to parse (script #${i + 1}): ${e.message}`);
    process.exit(1);
  }
}

/* ---- 校验通过才落盘 ---- */
fs.writeFileSync(P, h);

console.log(
  '[inject] ok  key_len=' + key.length +
  '  urls=' + urls.split('\n').length +
  '  scripts=' + blocks.length + ' parsed' +
  '  -> ' + P + '  (source untouched)'
);
