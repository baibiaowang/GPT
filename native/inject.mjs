import fs from 'node:fs';
import path from 'node:path';
const SRC='www', OUT='dist/www', ENTRY='index.html';
if(!fs.existsSync(path.join(SRC,ENTRY))){console.error('::error::missing '+path.join(SRC,ENTRY));process.exit(1);}
fs.rmSync(OUT,{recursive:true,force:true});fs.cpSync(SRC,OUT,{recursive:true});
const p=path.join(OUT,ENTRY), h=fs.readFileSync(p,'utf8');
if(h.includes('__AES_KEY__')){console.error('::error::AES key placeholder found; activation key must be entered in the App.');process.exit(1);}
const required=['table-model.js','cell-model.js','column-manager.js','row-manager.js','filter-engine.js','local-annotation.js','app-runtime.js'];
for(const f of required){const pth=path.join(OUT,'core',f);if(!fs.existsSync(pth)){console.error('::error::missing core module '+pth);process.exit(1);}try{new Function(fs.readFileSync(pth,'utf8'));}catch(e){console.error('::error::core JS parse failed '+f+': '+e.message);process.exit(1);}}
const {spawnSync}=await import('node:child_process');
const os=await import('node:os');
const blocks=[...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
for(let i=0;i<blocks.length;i++){
  try{new Function(blocks[i]);}
  catch(e){
    const fp=path.join(os.tmpdir(),'gpt-script-'+(i+1)+'.js');
    fs.writeFileSync(fp,blocks[i]);
    const chk=spawnSync(process.execPath,['--check',fp],{encoding:'utf8'});
    console.error('::error::JS parse failed #'+(i+1)+': '+e.message);
    if(chk.stdout)console.error(chk.stdout.trim());
    if(chk.stderr)console.error(chk.stderr.trim());
    process.exit(1);
  }
}
const legacyMarkers=['stock-table','v2-filter-card','v2Cols','v2TS','v2CS','v20','t20','sj.fav.v3','sj.cmt.v3'];
for(const marker of legacyMarkers){
  if(h.includes(marker)){
    console.error('::error::legacy UI/runtime marker remains in index.html: '+marker);
    process.exit(1);
  }
}
const runtime=fs.readFileSync(path.join(OUT,'core','app-runtime.js'),'utf8');
if(!/version:\s*['"]2\.1\.0['"]/.test(runtime)||!/versionCode:\s*2101/.test(runtime)){
  console.error('::error::runtime version is not 2.1.1 / 2101');
  process.exit(1);
}
if(!h.includes('core/app-runtime.js')){console.error('::error::index.html does not load app-runtime.js');process.exit(1);}
fs.writeFileSync(p,h);console.log('[inject] generic table runtime validated · v2.1.1');
