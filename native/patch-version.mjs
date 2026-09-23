import fs from 'node:fs';
const rawCode=String(process.env.APP_VERSION_CODE||'').trim();
const name=String(process.env.APP_VERSION_NAME||'').trim();
if(!/^\d+$/.test(rawCode)||!/^\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?$/.test(name)){
  console.error('::error::APP_VERSION_CODE/APP_VERSION_NAME must be provided by the build workflow');
  process.exit(1);
}
const code=Number(rawCode);
if(!Number.isSafeInteger(code)||code<=0){
  console.error('::error::APP_VERSION_CODE is invalid');
  process.exit(1);
}
const p='android/app/build.gradle';
if(!fs.existsSync(p)){console.error('::error::android/app/build.gradle not found');process.exit(1);}
let s=fs.readFileSync(p,'utf8');
if(!/versionCode\s+\d+/.test(s)||!/versionName\s+"[^"]*"/.test(s)){console.error('::error::version fields not found');process.exit(1);}
s=s.replace(/versionCode\s+\d+/,'versionCode '+code);
s=s.replace(/versionName\s+"[^"]*"/,'versionName "'+name+'"');
fs.writeFileSync(p,s);
console.log('[patch-version] '+name+' ('+code+')');
