/**
 * 往 `npx cap add android` 生成的 AndroidManifest.xml 里注入 text/plain 的 intent-filter，
 * 让「用其他应用打开 txt」时本应用出现在候选列表里。
 *
 * 用法（在仓库根目录执行）：
 *   node native/patch-manifest.mjs
 */
import fs from 'node:fs';

const P = 'android/app/src/main/AndroidManifest.xml';
const MARK = 'sj-open-txt';

if (!fs.existsSync(P)) {
  console.error('[patch-manifest] not found: ' + P);
  process.exit(1);
}

let m = fs.readFileSync(P, 'utf8');

if (m.indexOf(MARK) >= 0) {
  console.log('[patch-manifest] already patched, skip');
  process.exit(0);
}

/* ★ 2026-09-20 修：原实现用 lastIndexOf('</activity>')。
   manifest 里只要多出一个 activity（插件、别的入口等），
   intent-filter 就会被注入到**最后一个** activity 上而不是 MainActivity，
   而且不报错、构建照样成功 —— 表现为「装了 App 但文件管理器里不出现」。
   现在按 android:name="…MainActivity" 精确定位它所属的 activity 块。 */
const re = /android:name="(?:[A-Za-z0-9_.]*\.)?MainActivity"/;
const mt = re.exec(m);
if (!mt) {
  console.error('[patch-manifest] cannot find android:name=".MainActivity"');
  process.exit(1);
}
const idx = m.indexOf('</activity>', mt.index);
if (idx < 0) {
  console.error('[patch-manifest] cannot find </activity> after MainActivity');
  process.exit(1);
}

const inject = [
  '',
  '            <!-- ' + MARK + ': 允许从文件管理器 / 浏览器用本应用打开 txt -->',
  '            <intent-filter>',
  '                <action android:name="android.intent.action.VIEW" />',
  '                <category android:name="android.intent.category.DEFAULT" />',
  '                <category android:name="android.intent.category.BROWSABLE" />',
  '                <data android:mimeType="text/plain" />',
  '            </intent-filter>',
  '        ',
].join('\n');

m = m.slice(0, idx) + inject + m.slice(idx);
fs.writeFileSync(P, m);
console.log('[patch-manifest] patched ok (MainActivity at ' + mt.index + ', insert at ' + idx + ')');
