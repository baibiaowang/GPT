import fs from 'node:fs';
import path from 'node:path';
const SRC='www', OUT='dist/www', ENTRY='index.html';
if(!fs.existsSync(path.join(SRC,ENTRY))){console.error('::error::missing '+path.join(SRC,ENTRY));process.exit(1);}
fs.rmSync(OUT,{recursive:true,force:true});fs.cpSync(SRC,OUT,{recursive:true});
const p=path.join(OUT,ENTRY), h=fs.readFileSync(p,'utf8');
if(h.includes('__AES_KEY__')){console.error('::error::AES key placeholder found; activation key must be entered in the App.');process.exit(1);}
const blocks=[...h.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(m=>m[1]);
for(let i=0;i<blocks.length;i++){try{new Function(blocks[i]);}catch(e){console.error('::error::JS parse failed #'+(i+1)+': '+e.message);process.exit(1);}}
fs.writeFileSync(p,h);console.log('[inject] built-in public data URLs + manual activation key only');
