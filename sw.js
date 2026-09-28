const CACHE='zizhi-rss-shell-v3.0.14';
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.json','./assets/rss-icon.svg'];
const NETWORK_FIRST=new Set(['/','/index.html','/styles.css','/app.js','/manifest.json','/sw.js']);
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function networkFirst(req){try{const r=await fetch(req,{cache:'no-store'});if(r?.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(req,c)).catch(()=>{})}return r}catch{const c=await caches.match(req);return c||Response.error()}}
async function cacheFirst(req){const c=await caches.match(req);if(c)return c;try{const r=await fetch(req);if(r?.ok){const q=r.clone();caches.open(CACHE).then(x=>x.put(req,q)).catch(()=>{})}return r}catch{return Response.error()}}
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==self.location.origin||e.request.method!=='GET')return;e.respondWith(NETWORK_FIRST.has(u.pathname)?networkFirst(e.request):cacheFirst(e.request))});
