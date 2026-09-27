const CACHE='zizhi-rss-shell-v3.0.9';
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.json','./assets/rss-icon.svg'];
const NETWORK_FIRST=new Set(['/','/index.html','/styles.css','/app.js','/manifest.json','/sw.js']);
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function networkFirst(req){
 try{
   const res=await fetch(req,{cache:'no-store'});
   if(res&&res.ok){
     const copy=res.clone();
     caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
   }
   return res;
 }catch{
   const cached=await caches.match(req);
   return cached||Response.error();
 }
}
async function cacheFirst(req){
 const cached=await caches.match(req);
 if(cached)return cached;
 try{
   const res=await fetch(req);
   if(res&&res.ok){
     const copy=res.clone();
     caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
   }
   return res;
 }catch{return Response.error();}
}
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(u.origin!==self.location.origin)return;
 if(e.request.method!=='GET')return;
 const path=u.pathname;
 e.respondWith(NETWORK_FIRST.has(path)?networkFirst(e.request):cacheFirst(e.request));
});
