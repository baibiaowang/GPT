import fs from 'node:fs';
import path from 'node:path';

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const version=String(pkg.version||'').trim();
const code=Number(pkg.versionCode||0);

const out='mobile-web';
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
for(const f of ['index.html','styles.css','app.js','manifest.json','sw.js']) {
  fs.copyFileSync(f,path.join(out,f));
}
fs.cpSync('assets',path.join(out,'assets'),{recursive:true});

const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const app=fs.readFileSync(path.join(out,'app.js'),'utf8');
if(!html.includes('自制RSS'))throw new Error('自制RSS title missing');
if(!/^3\.\d+\.\d+$/.test(version)||!Number.isSafeInteger(code)||code<=0) {
  throw new Error('invalid RSS version metadata');
}
if(!app.includes(`APP_VERSION='${version}'`)||!app.includes(`APP_VERSION_CODE=${code}`)) {
  throw new Error(`app.js version constants do not match ${version}/${code}`);
}
new Function(app);
console.log('Prepared mobile web bundle: 自制RSS '+version+' ('+code+')');
