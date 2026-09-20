/**
 * 构建时把 www/ 复制到 dist/www 并注入数据源/可选激活码。
 *
 * AES_KEY 可选：没有配置时保留占位符，App 首次打开会进入设置页面，
 * 用户可以在 App 内填写激活码。配置了 AES_KEY 时则在构建期注入并严格校验。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC='www';
const OUT='dist/www';
const ENTRY='index.html';

const DEFAULT_URLS=[
  'https://cdn.jsdelivr.net/gh/baibiaowang/stock-judge-app@main/data/stocks.txt',
  'https://raw.githubusercontent.com/baibiaowang/stock-judge-app/main/data/stocks.txt'
].join('\n');

const key=(process.env.AES_KEY||'').trim();
const urls=(process.env.DATA_URL||'').trim()||DEFAULT_URLS;

if(!fs.existsSync(path.join(SRC,ENTRY))){
  console.error('::error::missing '+path.join(SRC,ENTRY));
  process.exit(1);
}

const src=fs.readFileSync(path.join(SRC,ENTRY),'utf8');

if(key && !/^[0-9a-fA-F]{64}$/.test(key)){
  console.error('::error::AES_KEY malformed (need 64 hex chars)');
  process.exit(1);
}
if(key && src.includes(key)){
  console.error('::error::source already contains real key');
  process.exit(1);
}

function jsSingle(s){
  return String(s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/\r/g,'\\r')
    .replace(/\n/g,'\\n')
    .replace(/\u2028/g,'\\u2028')
    .replace(/\u2029/g,'\\u2029');
}

fs.rmSync(OUT,{recursive:true,force:true});
fs.cpSync(SRC,OUT,{recursive:true});

const p=path.join(OUT,ENTRY);
let h=fs.readFileSync(p,'utf8');

h=h.split('__DATA_URL__').join(jsSingle(urls));
if(key) h=h.split('__AES_KEY__').join(jsSingle(key));

if(h.includes('__DATA_URL__')){
  console.error('::error::DATA_URL placeholder remains');
  process.exit(1);
}
if(!key && !h.includes('__AES_KEY__')){
  console.error('::error::AES_KEY placeholder unexpectedly missing');
  process.exit(1);
}

const blocks=[...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
if(!blocks.length){
  console.error('::error::no <script> block found');
  process.exit(1);
}
for(let i=0;i<blocks.length;i++){
  try{new Function(blocks[i]);}
  catch(e){
    console.error('::error::injected JS parse failed #'+(i+1)+': '+e.message);
    process.exit(1);
  }
}

fs.writeFileSync(p,h);
console.log('[inject] ok key='+ (key?'injected':'manual-input') +' urls='+urls.split('\n').length+' scripts='+blocks.length);
