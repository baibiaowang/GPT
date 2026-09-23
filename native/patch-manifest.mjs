import fs from 'node:fs';

const P = 'android/app/src/main/AndroidManifest.xml';
const INSTALL_PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';
const PROVIDER_MARK = 'sj-file-provider';

if (!fs.existsSync(P)) {
  console.error('[patch-manifest] not found: ' + P);
  process.exit(1);
}

let m = fs.readFileSync(P, 'utf8');

if (m.indexOf('uses-permission android:name="' + INSTALL_PERMISSION + '"') < 0) {
  const appIdx = m.indexOf('<application');
  if (appIdx < 0) {
    console.error('[patch-manifest] cannot find <application>');
    process.exit(1);
  }
  m = m.slice(0, appIdx) +
    '    <uses-permission android:name="' + INSTALL_PERMISSION + '" />\n' +
    m.slice(appIdx);
}


const xmlDir = 'android/app/src/main/res/xml';
fs.mkdirSync(xmlDir, {recursive: true});
const pathsXml = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="stock_judge_downloads" path="Download/股票判断机" />
    <external-files-path name="external_files" path="." />
    <cache-path name="cache" path="." />
    <files-path name="files" path="." />
</paths>
`;
fs.writeFileSync(xmlDir + '/sj_file_paths.xml', pathsXml);

if (m.indexOf(PROVIDER_MARK) < 0) {
  const appEnd = m.lastIndexOf('</application>');
  if (appEnd < 0) {
    console.error('[patch-manifest] cannot find </application>');
    process.exit(1);
  }
  const provider = [
    '',
    '        <!-- ' + PROVIDER_MARK + ': 将本地 APK 包装成 content:// URI，供安装器安全读取 -->',
    '        <provider',
    '            android:name="androidx.core.content.FileProvider"',
    '            android:authorities="${applicationId}.fileprovider"',
    '            android:exported="false"',
    '            android:grantUriPermissions="true">',
    '            <meta-data',
    '                android:name="android.support.FILE_PROVIDER_PATHS"',
    '                android:resource="@xml/sj_file_paths" />',
    '        </provider>',
    '    '
  ].join('\n');
  m = m.slice(0, appEnd) + provider + m.slice(appEnd);
}

fs.writeFileSync(P, m);
console.log('[patch-manifest] patched ok');
