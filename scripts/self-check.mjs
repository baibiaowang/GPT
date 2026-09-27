import fs from 'node:fs';

const fail = message => { throw new Error(message); };
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const app = fs.readFileSync('app.js','utf8');
const native = fs.readFileSync('native/MainActivity.java','utf8');
const sw = fs.readFileSync('sw.js','utf8');
const iconPatch = fs.readFileSync('native/patch-icon.mjs','utf8');

const version = String(pkg.version || '').trim();
const versionCode = Number(pkg.versionCode || 0);

if (!/^3\.\d+\.\d+$/.test(version)) fail('package.json version 必须是 3.x.y');
if (!Number.isSafeInteger(versionCode) || versionCode < 3000) fail('package.json versionCode 无效');
if (!app.includes("APP_VERSION='" + version + "'")) fail('app.js APP_VERSION 与 package.json 不一致');
if (!app.includes('APP_VERSION_CODE=' + versionCode)) fail('app.js APP_VERSION_CODE 与 package.json 不一致');
if (!sw.includes('zizhi-rss-shell-v' + version)) fail('Service Worker 缓存版本与 App 版本不一致');
if (!app.includes("updateViaCache:'none'")) fail('Service Worker 更新缓存策略未关闭');
if (!app.includes('UPDATE_MANIFEST_URLS')) fail('更新清单必须配置多源地址');

for (const marker of [
  'function isTrustedUpdateUrl',
  'safeContent=sanitize',
  'function normalizeHttpsUrl',
  'initialRequest ? appendCacheBuster(current) : current',
  'notifyJsSaveResult',
  'requestCode == IMPORT_REQUEST',
  'zizhi-rss-import-backup',
  "window.addEventListener('popstate'"
]) {
  if (!app.includes(marker) && !native.includes(marker)) fail('缺少关键修复：' + marker);
}

if (/agu-ann-feed\.app\.workbuddy\.host/.test(app + '\\n' + native + '\\n' + manifest)) {
  fail('公开源码中发现私有 RSS 地址，请不要提交带 token 的订阅地址');
}
if ((native.match(/initialRequest/g) || []).length !== 3) fail('APK重定向缓存状态代码不完整');
if (!fs.existsSync('index.html') || !fs.existsSync('styles.css') || !fs.existsSync('manifest.json')) fail('RSS web source files missing');
if (!fs.existsSync('assets/rss-icon.svg')) fail('RSS icon missing');
if (!native.includes('resolveResponseCharset')) fail('native charset handling missing');
console.log('RSS self-check passed:', version, versionCode);
