import fs from 'node:fs';

const p='android/app/src/main/AndroidManifest.xml';
if(!fs.existsSync(p))throw new Error('AndroidManifest.xml not found');
let s=fs.readFileSync(p,'utf8');

const hasAppIcon=s.includes('android:icon=');
const hasAppRoundIcon=s.includes('android:roundIcon=');
if(hasAppIcon) {
  s=s.replace(/android:icon="[^"]*"/g,'android:icon="@mipmap/ic_launcher"');
} else {
  s=s.replace('<application','<application android:icon="@mipmap/ic_launcher"');
}
if(hasAppRoundIcon) {
  s=s.replace(/android:roundIcon="[^"]*"/g,'android:roundIcon="@mipmap/ic_launcher_round"');
} else {
  s=s.replace('<application','<application android:roundIcon="@mipmap/ic_launcher_round"');
}

if(!s.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
  s=s.replace('<application','<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <application');
}

const xmlDir='android/app/src/main/res/xml';
fs.mkdirSync(xmlDir,{recursive:true});
fs.writeFileSync(xmlDir+'/rss_file_paths.xml',`<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <cache-path name="cache" path="." />
  <files-path name="files" path="." />
  <external-files-path name="external_files" path="." />
</paths>\n`);

const providerBlock=`    <!-- zizhi-rss-file-provider -->
    <provider
        android:name="androidx.core.content.FileProvider"
        android:authorities="\${applicationId}.fileprovider"
        android:exported="false"
        android:grantUriPermissions="true">
        <meta-data
            android:name="android.support.FILE_PROVIDER_PATHS"
            android:resource="@xml/rss_file_paths" />
    </provider>`;

const providerRe=/[ \t]*<provider\b[^>]*android:name="androidx\.core\.content\.FileProvider"[^>]*>[\s\S]*?<\/provider>[ \t]*/;
if(providerRe.test(s)) {
  s=s.replace(providerRe,'\n'+providerBlock+'\n');
} else {
  if(!s.includes('</application>'))throw new Error('application closing tag not found');
  s=s.replace('</application>','\n'+providerBlock+'\n    </application>');
}

s=s.replace(/[ \t]+\r?\n/g,'\n');
s=s.replace(/\n{3,}/g,'\n\n');
fs.writeFileSync(p,s);
console.log('RSS FileProvider manifest patched');
