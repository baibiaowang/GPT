import fs from 'node:fs';
const p='android/app/build.gradle';
const code=Number(process.env.APP_VERSION_CODE||1500);
const name=String(process.env.APP_VERSION_NAME||'1.5.0');
if(!fs.existsSync(p)){console.error('::error::android/app/build.gradle not found');process.exit(1);}
let s=fs.readFileSync(p,'utf8');
if(!/versionCode\s+\d+/.test(s)||!/versionName\s+"[^"]*"/.test(s)){console.error('::error::version fields not found');process.exit(1);}
s=s.replace(/versionCode\s+\d+/,'versionCode '+code);
s=s.replace(/versionName\s+"[^"]*"/,'versionName "'+name+'"');
fs.writeFileSync(p,s);
console.log('[patch-version] '+name+' ('+code+')');
