import fs from 'node:fs';

const fail = message => { throw new Error(message); };
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const app = fs.readFileSync('app.js','utf8');
const native = fs.readFileSync('native/MainActivity.java','utf8');
const sw = fs.readFileSync('sw.js','utf8');

const version = String(pkg.version || '').trim();
const versionCode = Number(pkg.versionCode || 0);

if (!/^4\.\d+\.\d+$/.test(version)) fail('package.json version 必须是 4.x.y');
if (!Number.isSafeInteger(versionCode) || versionCode < 4000) fail('package.json versionCode 无效');
if (!app.includes("APP_VERSION='" + version + "'")) fail('app.js APP_VERSION 与 package.json 不一致');
if (!app.includes('APP_VERSION_CODE=' + versionCode)) fail('app.js APP_VERSION_CODE 与 package.json 不一致');
if (!sw.includes('zizhi-rss-shell-v' + version)) fail('Service Worker 缓存版本不一致');

for (const marker of [
  "function parseXml",
  "function refreshSource",
  "function checkUpdate",
  "window.restoreBackupText",
  "window.__rssApkDownloadProgress",
  "UPDATE_MANIFEST_URLS"
]) {
  if (!app.includes(marker)) fail('缺少核心 RSS 功能：' + marker);
}

for (const legacy of [
  'stock-rss-reader',
  'sourceType',
  'schema_version',
  'judge-types',
  '利好',
  '不利',
  '否决'
]) {
  if (app.includes(legacy)) fail('app.js 仍残留旧股票判断逻辑：' + legacy);
}

if (!fs.existsSync('index.html') || !fs.existsSync('styles.css') || !fs.existsSync('manifest.json')) fail('RSS web source files missing');
if (!fs.existsSync('assets/rss-icon.svg')) fail('RSS icon missing');
if (!native.includes('resolveResponseCharset')) fail('native charset handling missing');
if (!native.includes('isTrustedUpdateUrl')) fail('native update URL validation missing');

console.log('RSS 4 self-check passed:', version, versionCode);
