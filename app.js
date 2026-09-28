/* 自制 RSS 阅读器 4.0.0
 * 专用于 agu-ann-feed，同时兼容标准 RSS 2.0。
 * 本文件是全新客户端核心：本地状态只按 guid 绑定，旧股票判断机数据不参与迁移。
 */
const APP_VERSION='3.0.16', APP_VERSION_CODE=3016;
const DEFAULT_BASE='https://agu-ann-feed.app.workbuddy.host';
const UPDATE_MANIFEST_URLS=[
  'https://raw.githubusercontent.com/baibiaowang/GPT/main/update.json',
  'https://cdn.jsdelivr.net/gh/baibiaowang/GPT@main/update.json',
  'https://fastly.jsdelivr.net/gh/baibiaowang/GPT@main/update.json'
];
const DB_NAME='zizhi-rss-reader', DB_VERSION=1;
const STORE_SOURCES='sources', STORE_ARTICLES='articles', BACKUP_VERSION=1;
const MIN_REFRESH_INTERVAL_MS=60*1000;
const navTitles={home:'首页',categories:'分类',notes:'点评',favorites:'收藏',settings:'设置'};
const app=document.getElementById('app'), modalRoot=document.getElementById('modalRoot'), toastEl=document.getElementById('toast');
const importFileEl=document.getElementById('importFile');
const state={page:'home',search:'',category:'',date:'',sources:[],articles:[],detailGuid:null,detailHistory:false,loading:false};
const now=()=>new Date().toISOString();
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const textOf=h=>{const d=document.createElement('div');d.innerHTML=String(h||'');return d.textContent||d.innerText||''};
const fmtTime=v=>{if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
const fmtDate=v=>{if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return d.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})};
const toast=m=>{toastEl.textContent=String(m||'');toastEl.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove('show'),2800)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function openDb(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{const d=r.result;
      if(!d.objectStoreNames.contains(STORE_SOURCES))d.createObjectStore(STORE_SOURCES,{keyPath:'id'});
      if(!d.objectStoreNames.contains(STORE_ARTICLES))d.createObjectStore(STORE_ARTICLES,{keyPath:'guid'});
    };
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
}
async function storeGetAll(name){const d=await openDb();return new Promise((res,rej)=>{const r=d.transaction(name,'readonly').objectStore(name).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
async function storePut(name,val){const d=await openDb();return new Promise((res,rej)=>{const t=d.transaction(name,'readwrite');t.objectStore(name).put(val);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
async function storeDel(name,key){const d=await openDb();return new Promise((res,rej)=>{const t=d.transaction(name,'readwrite');t.objectStore(name).delete(key);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
async function clearStores(){const d=await openDb();return new Promise((res,rej)=>{const t=d.transaction([STORE_SOURCES,STORE_ARTICLES],'readwrite');t.objectStore(STORE_SOURCES).clear();t.objectStore(STORE_ARTICLES).clear();t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
async function clearArticles(){const d=await openDb();return new Promise((res,rej)=>{const t=d.transaction(STORE_ARTICLES,'readwrite');t.objectStore(STORE_ARTICLES).clear();t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}

function normalizeHttps(v){
  try{const u=new URL(String(v||''));return u.protocol==='https:'&&u.hostname?u.toString():''}catch{return''}
}
function feedUrl(source){
  const base=normalizeHttps(source.url||DEFAULT_BASE); if(!base)throw new Error('订阅地址必须是 HTTPS');
  const u=new URL(base);
  if(u.pathname==='/')u.pathname='/feed';
  if(!u.pathname.startsWith('/feed'))u.pathname='/feed';
  if(source.token)u.searchParams.set('token',source.token);
  if(source.category)u.searchParams.set('category',source.category);
  return u.toString();
}
function sourceId(url,category=''){return btoa(unescape(encodeURIComponent(String(url)+'|'+String(category)))).replace(/[^A-Za-z0-9]/g,'').slice(0,48)}

function parseXml(xml){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('RSS XML 解析失败');
  const items=[...doc.querySelectorAll('item')];
  if(!items.length)throw new Error('RSS 中没有文章');
  return items.map(it=>{
    const node=n=>it.querySelector(n);
    const html=node('description')?.textContent||'';
    const box=document.createElement('div');box.innerHTML=html;
    const links=[...box.querySelectorAll('a')].map(a=>normalizeHttps(a.href)).filter(Boolean);
    const title=node('title')?.textContent?.trim()||'无标题';
    const guid=node('guid')?.textContent?.trim()||node('link')?.textContent?.trim()||title;
    const category=node('category')?.textContent?.trim()||extractLine(html,'分类')||extractBracketCategory(title)||'其他';
    const stock=extractStock(title,html);
    const summary=extractSummary(html);
    const answers=extractAnswers(html);
    const pub=node('pubDate')?.textContent?.trim()||new Date().toISOString();
    return {
      guid:String(guid), title, category, publishedAt:pub, summary, answers,
      stock, links:{announcement:normalizeHttps(node('link')?.textContent?.trim())||links[0]||'',pdf:findPdf(links)},
      rawHtml:html
    };
  });
}
function extractLine(html,label){const t=textOf(html).split(/\r?\n/).map(s=>s.trim());const p=t.find(s=>s.startsWith(label+'：')||s.startsWith(label+':'));return p?p.replace(/^.*?[：:]\s*/,'').trim():''}
function extractBracketCategory(t){const m=String(t).match(/^\[([^\]]+)\]/);return m?m[1]:''}
function extractSummary(html){return extractLine(html,'AI总结')||textOf(html).replace(/^【.*?】.*$/m,'').slice(0,500)}
function extractStock(title,html){
  const s=title+' '+textOf(html);
  const m=s.match(/([\u4e00-\u9fffA-Za-z0-9·.（）()]+?)\s*[（(]\s*(\d{6})\s*[）)]/);
  return m?{name:m[1].trim(),code:m[2]}:{name:'',code:''};
}
function findPdf(links){return links.find(x=>/\\.pdf(?:[?#]|$)/i.test(x))||''}
function extractAnswers(html){
  const t=textOf(html).split(/\r?\n/).map(s=>s.trim()).filter(Boolean), out={};
  t.forEach(line=>{const m=line.match(/^([^：:]{2,40})[：:]\\s*(.+)$/);if(m&&!/^(AI总结|股票|公告标题|公告日期|链接|分类)$/.test(m[1]))out[m[1]]=m[2].trim()});
  return out
}

function decodeBase64Utf8(s){
  const bin=atob(String(s||'')),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
async function readNativeFile(chunkFn){
  let offset=0,out='',decoder=new TextDecoder('utf-8');
  for(let i=0;i<2048;i++){
    const b=window.AndroidNative?.[chunkFn]?.(offset,131072)||'';
    if(!b)break;
    const bin=atob(String(b)),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
    out+=decoder.decode(bytes,{stream:true}); offset+=bytes.length;
    if(bytes.length<131072)break;
  }
  out+=decoder.decode();
  return out;
}
function waitNativeResult(name,trigger,timeout=45000){
  return new Promise((resolve,reject)=>{
    let done=false,timer=setTimeout(()=>{if(!done){done=true;reject(new Error('原生读取超时'))}},timeout);
    window[name]=(ok,msg)=>{if(done)return;done=true;clearTimeout(timer);if(ok)resolve(msg||'');else reject(new Error(msg||'读取失败'))};
    try{trigger()}catch(e){done=true;clearTimeout(timer);reject(e)}
  });
}
async function fetchText(url,kind='feed'){
  const u=String(url||'').trim();
  if(window.AndroidNative){
    const result=await waitNativeResult(kind==='feed'?'__rssNativeFeedResult':'__rssUpdateResult',
      ()=>kind==='feed'?window.AndroidNative.fetchFeed(u):window.AndroidNative.fetchUpdateManifest(u));
    return await readNativeFile(kind==='feed'?'readFeedChunk':'readUpdateChunk');
  }
  const r=await fetch(u,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return await r.text();
}
function mergeArticle(old,a,source){
  const meta=old||{};
  return {...a,guid:String(a.guid),sourceId:source.id,sourceName:source.name,
    firstSeenAt:meta.firstSeenAt||now(),lastSeenAt:now(),
    read:Boolean(meta.read),favorite:Boolean(meta.favorite),notes:Array.isArray(meta.notes)?meta.notes:[],
  };
}
async function refreshSource(source){
  const last=Date.parse(source.lastAttemptAt||'');
  if(Number.isFinite(last)){const remain=MIN_REFRESH_INTERVAL_MS-(Date.now()-last);if(remain>0)throw new Error('为避免频繁请求，请 '+Math.ceil(remain/1000)+' 秒后再刷新');}
  const url=feedUrl(source);
  source.lastError=''; source.lastAttemptAt=now(); await storePut(STORE_SOURCES,source);
  const xml=await fetchText(url,'feed');
  const incoming=parseXml(xml);
  const existing=await storeGetAll(STORE_ARTICLES);
  const map=new Map(existing.map(a=>[a.guid,a]));
  for(const item of incoming)await storePut(STORE_ARTICLES,mergeArticle(map.get(item.guid),item,source));
  source.lastSyncAt=now();source.lastItemCount=incoming.length;source.lastError='';
  await storePut(STORE_SOURCES,source);
  return incoming.length;
}
async function refreshAll(){
  if(!state.sources.length){toast('请先在设置添加订阅源');return}
  if(state.loading)return;
  state.loading=true;render();
  let ok=0,fail=0;
  for(const s of state.sources){
    try{await refreshSource(s);ok++}catch(e){fail++;s.lastError=String(e.message||e);await storePut(STORE_SOURCES,s)}
  }
  await loadState();state.loading=false;render();
  toast(fail?('刷新完成：成功 '+ok+' 个，失败 '+fail+' 个'):('刷新完成：'+state.sources.reduce((n,s)=>n+(s.lastItemCount||0),0)+' 条'));
}
function categoryList(){
  const m=new Map();for(const a of state.articles){const c=a.category||'其他';m.set(c,(m.get(c)||0)+1)}return [...m.entries()].sort((a,b)=>b[1]-a[1])
}
function searchArticles(arr){
  const q=state.search.trim().toLowerCase();if(!q)return arr;
  return arr.filter(a=>[a.title,a.category,a.summary,a.stock?.name,a.stock?.code,textOf(a.rawHtml),a.sourceName].some(v=>String(v||'').toLowerCase().includes(q)));
}
function visibleArticles(){
  let arr=state.articles.slice();
  if(state.category)arr=arr.filter(a=>a.category===state.category);
  if(state.date)arr=arr.filter(a=>{const d=new Date(a.publishedAt||0);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===state.date});
  arr=searchArticles(arr);
  arr.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
  return arr;
}

function render(){
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));
  if(state.page==='home')renderHome();
  else if(state.page==='categories')renderCategories();
  else if(state.page==='notes')renderNotes();
  else if(state.page==='favorites')renderFavorites();
  else renderSettings();
}
function toolbar(){return '<div class="toolbar"><input id="globalSearch" class="search" placeholder="搜索标题、股票、分类、总结" value="'+esc(state.search)+'"><button class="pill" id="clearSearch">清除</button></div>'}
function articleCard(a){
  const unread=!a.read, fav=a.favorite;
  const stock=a.stock?.name?(a.stock.name+(a.stock.code?' · '+a.stock.code:'')):'';
    return '<article class="article-card '+(unread?'unread':'read')+'" data-guid="'+esc(a.guid)+'">'+
    '<div class="article-top"><div class="article-heading"><div class="article-kicker">'+esc(a.category||'其他')+'</div><h3 class="article-title">'+esc(a.title||'无标题')+'</h3></div>'+
    '<button class="favorite-button '+(fav?'active':'')+'" data-fav="'+esc(a.guid)+'">'+(fav?'★':'☆')+'</button></div>'+
    '<div class="article-meta"><span>'+esc(stock||'综合')+'</span><span>'+esc(fmtTime(a.publishedAt))+'</span></div>'+
    (a.summary?'<div class="article-excerpt">'+esc(a.summary)+'</div>':'')+
    '<div class="article-actions"><span class="read-state">'+(unread?'未读':'已读')+'</span><button class="small-button" data-open="'+esc(a.guid)+'">阅读</button></div>'+
  '</article>'
}
function emptyState(title,desc,actionText,action){
  return '<div class="empty"><div class="empty-icon">◎</div><div class="empty-title">'+esc(title)+'</div><div class="empty-desc">'+esc(desc)+'</div>'+
    (actionText?'<button class="primary" id="emptyAction">'+esc(actionText)+'</button>':'')+'</div>'
}
function bindList(){
  const q=document.getElementById('globalSearch');if(q)q.oninput=()=>{state.search=q.value;const list=document.getElementById('articleList');if(list)list.innerHTML=visibleArticles().map(articleCard).join('')||emptyState('没有匹配文章','换个关键词再试。');bindList()};
  const c=document.getElementById('clearSearch');if(c)c.onclick=()=>{state.search='';render()};
  document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const a=state.articles.find(x=>x.guid===b.dataset.fav);if(!a)return;a.favorite=!a.favorite;await storePut(STORE_ARTICLES,a);await loadState();render();toast(a.favorite?'已收藏':'已取消收藏')});
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openDetail(b.dataset.open));
  document.querySelectorAll('.article-card').forEach(c=>c.onclick=e=>{if(!e.target.closest('button'))openDetail(c.dataset.guid)});
}
function renderHome(){
  state.category='';
  const arr=visibleArticles();
  const body=arr.length?arr.map(articleCard).join(''):emptyState(state.sources.length?'暂无文章':'还没有订阅源',state.sources.length?'点击刷新获取最新公告。':'在设置中添加 agu-ann-feed 订阅源。',state.sources.length?'立即刷新':'去设置',state.sources.length?refreshAll:()=>{state.page='settings';render()});
  app.innerHTML='<div class="hero-row"><div><div class="eyebrow">AGU ANN FEED</div><div class="section-title">公告流</div><div class="section-subtitle">'+state.articles.length+' 条本机文章</div></div><button class="round-refresh '+(state.loading?'busy':'')+'" id="inlineRefresh">↻</button></div>'+toolbar()+
    '<div class="filter-summary">'+(state.search?'搜索：'+esc(state.search):'全部文章')+'</div><div id="articleList">'+body+'</div>';
  document.getElementById('inlineRefresh')?.addEventListener('click',refreshAll);
  document.getElementById('emptyAction')?.addEventListener('click',()=>{const f=state.sources.length?refreshAll:()=>{state.page='settings';render()};f()});
  bindList()
}
function dateList(){const m=new Map();for(const a of state.articles){const d=new Date(a.publishedAt||0);if(Number.isNaN(d.getTime()))continue;const k=d.toISOString().slice(0,10);m.set(k,(m.get(k)||0)+1)}return [...m.entries()].sort((a,b)=>b[0].localeCompare(a[0]))}
function renderCategories(){
  const cats=categoryList(), dates=dateList();
  const options='<option value="">全部分类</option>'+cats.map(([c])=>'<option value="'+esc(c)+'" '+(c===state.category?'selected':'')+'>'+esc(c)+'</option>').join('');
  let groups='';
  for(const [d,n] of dates){
    const items=state.articles.filter(a=>{
      const x=new Date(a.publishedAt||0);
      return !Number.isNaN(x.getTime())&&x.toISOString().slice(0,10)===d&&(!state.category||a.category===state.category);
    }).sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
    if(!items.length)continue;
    groups+='<section class="date-section"><div class="date-section-head"><strong>'+esc(d.slice(5).replace('-','月')+'日')+'</strong><span>'+items.length+' 篇</span></div><div id="articleList-'+esc(d)+'">'+items.map(articleCard).join('')+'</div></section>';
  }
  app.innerHTML='<div class="section-head"><div><div class="section-title">分类</div><div class="section-subtitle">按日期浏览，分类可选择</div></div></div>'+
    '<div class="category-filter"><label>分类</label><select id="categorySelect">'+options+'</select></div>'+
    (state.category?'<div class="active-filter">当前分类：'+esc(state.category)+'</div>':'')+
    (groups||emptyState('没有文章','当前分类下暂无文章。'));
  document.getElementById('categorySelect')?.addEventListener('change',e=>{state.category=e.target.value;renderCategories()});
  bindList()
}
function renderNotes(){
  const arr=state.articles.filter(a=>Array.isArray(a.notes)&&a.notes.length).sort((a,b)=>new Date(b.notes?.at(-1)?.time||0)-new Date(a.notes?.at(-1)?.time||0));
  app.innerHTML='<div class="section-head"><div><div class="section-title">点评</div><div class="section-subtitle">'+arr.length+' 篇有点评的文章</div></div></div><div id="articleList">'+(arr.length?arr.map(articleCard).join(''):emptyState('还没有点评','打开文章后即可记录自己的点评。'))+'</div>';
  bindList()
}
function renderFavorites(){
  state.category='';state.date='';
  const arr=state.articles.filter(a=>a.favorite);
  app.innerHTML='<div class="section-head"><div><div class="section-title">收藏</div><div class="section-subtitle">'+arr.length+' 篇</div></div></div>'+toolbar()+
    '<div id="articleList">'+(arr.length?searchArticles(arr).sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt)).map(articleCard).join(''):emptyState('还没有收藏','阅读文章时点星收藏。'))+'</div>';
  bindList()
}
function renderSearch(){
  app.innerHTML='<div class="section-head"><div><div class="section-title">搜索</div><div class="section-subtitle">全字段检索</div></div></div>'+toolbar()+
    '<div id="articleList">'+(state.search?visibleArticles().map(articleCard).join(''):emptyState('输入关键词','搜索公告标题、股票、分类或 AI 总结。'))+'</div>';
  bindList()
}
function renderSettings(){
  const srcs=state.sources.map(s=>'<div class="source-setting-item"><div class="source-setting-main"><div class="source-setting-title"><strong>'+esc(s.name)+'</strong><span class="source-status '+(s.lastError?'error':s.lastSyncAt?'ok':'idle')+'">'+(s.lastError?'失败':s.lastSyncAt?'正常':'未刷新')+'</span></div><div class="source-setting-url">'+esc(s.url)+'</div><div class="source-setting-meta"><span>'+Number(s.lastItemCount||0)+' 条</span><span>'+(s.lastSyncAt?fmtTime(s.lastSyncAt):'尚未刷新')+'</span></div>'+(s.lastError?'<div class="source-error">'+esc(s.lastError)+'</div>':'')+'<div class="source-setting-actions"><button class="small-button" data-source-refresh="'+esc(s.id)+'">刷新</button><button class="small-button danger" data-source-delete="'+esc(s.id)+'">删除</button></div></div></div>').join('');
  app.innerHTML='<div class="settings-hero"><div class="settings-hero-mark">RSS</div><div class="settings-hero-main"><div class="eyebrow">AGU ANN FEED</div><h2>设置</h2><p>订阅源、更新、备份全部独立管理。</p></div><div class="version-badge">v'+APP_VERSION+'</div></div>'+
    '<section class="setting-card"><h2>添加订阅源</h2><label class="field"><span>名称</span><input id="sourceName" placeholder="例如：全部公告"></label><label class="field"><span>Feed URL</span><input id="sourceUrl" value="'+esc(DEFAULT_BASE+'/feed')+'" placeholder="https://.../feed"></label><label class="field"><span>Token</span><input id="sourceToken" type="password" autocomplete="off" placeholder="x-feed-token / token"></label><div class="setting-hint">分类由公告源自动提供；在“分类”页面可按分类或日期浏览，这里不需要填写分类。</div><button class="primary" id="addSource">保存订阅源</button></section>'+
    '<section class="setting-card"><div class="settings-section-head"><div><h2>现有订阅源</h2><div class="section-subtitle">'+state.sources.length+' 个</div></div><button class="small-button" id="refreshAll">全部刷新</button></div><div class="source-settings-list">'+(srcs||'<div class="settings-empty"><div>没有订阅源</div><span>输入 agu-ann-feed 地址和 Token。</span></div>')+'</div></section>'+
    '<section class="setting-card"><div class="settings-section-head"><div><h2>应用更新</h2><div class="section-subtitle">当前 '+APP_VERSION+' · '+APP_VERSION_CODE+'</div></div></div><button class="setting-row-button" id="checkUpdate"><span><strong>检查新版本</strong><small>从官方更新清单读取并校验 SHA-256</small></span><b>›</b></button><div class="update-progress" id="updateProgress"><div class="update-progress-line"><span id="updateDesc"></span><strong id="updatePct">0%</strong></div><div class="update-progress-track"><i id="updateFill"></i></div></div></section>'+
    '<section class="setting-card"><h2>本机数据</h2><div class="data-stats"><div><strong>'+state.articles.length+'</strong><span>文章</span></div><div><strong>'+state.articles.filter(a=>a.favorite).length+'</strong><span>收藏</span></div><div><strong>'+state.articles.filter(a=>a.read).length+'</strong><span>已读</span></div><div><strong>'+state.articles.filter(a=>a.notes?.length).length+'</strong><span>点评</span></div></div><div class="settings-action-grid"><button class="secondary" id="exportData">导出备份</button><button class="secondary" id="importData">导入备份</button></div></section>'+
    '<section class="setting-card danger-section"><h2>清空文章数据</h2><p class="danger-desc">只清除本机文章、已读、收藏和点评，订阅源及 Token 保留。</p><button class="danger-action" id="clearData">清空文章数据</button></section>';
  document.getElementById('addSource').onclick=addSource;
  document.getElementById('refreshAll').onclick=refreshAll;
  document.querySelectorAll('[data-source-refresh]').forEach(b=>b.onclick=async()=>{const s=state.sources.find(x=>x.id===b.dataset.sourceRefresh);if(!s)return;try{toast('正在刷新');await refreshSource(s);await loadState();render();toast('刷新成功')}catch(e){s.lastError=e.message||String(e);await storePut(STORE_SOURCES,s);await loadState();render();toast('刷新失败：'+s.lastError)}});
  document.querySelectorAll('[data-source-delete]').forEach(b=>b.onclick=async()=>{const s=state.sources.find(x=>x.id===b.dataset.sourceDelete);if(!s)return;if(!confirm('删除这个订阅源？本机已经保存的文章不会删除。'))return;await storeDel(STORE_SOURCES,s.id);await loadState();render()});
  document.getElementById('checkUpdate').onclick=checkUpdate;
  document.getElementById('exportData').onclick=exportBackup;
  document.getElementById('importData').onclick=()=>window.AndroidNative?.openBackupPicker?.()||importFileEl.click();
  document.getElementById('clearData').onclick=async()=>{if(!confirm('确定清空文章、已读、收藏和点评？订阅源会保留。'))return;await clearArticles();await loadState();render();toast('文章数据已清空，订阅源已保留')};
}
async function addSource(){
  const name=(document.getElementById('sourceName').value||'公告订阅').trim();
  const url=normalizeHttps(document.getElementById('sourceUrl').value||'');
  const token=(document.getElementById('sourceToken').value||'').trim();
  const category='';
  if(!url){toast('请输入 HTTPS Feed URL');return}
  if(!token){toast('请输入 Token');return}
  const s={id:sourceId(url,category),name,url,token,category,createdAt:now(),lastItemCount:0,lastSyncAt:'',lastError:''};
  await storePut(STORE_SOURCES,s);await loadState();render();toast('订阅源已保存');
  try{await refreshSource(s);await loadState();render();toast('首轮刷新完成')}catch(e){s.lastError=e.message||String(e);await storePut(STORE_SOURCES,s);await loadState();render();toast('订阅已保存，刷新失败：'+s.lastError)}
}

function openDetail(guid,push=true){
  const a=state.articles.find(x=>x.guid===guid);if(!a)return;
  a.read=true;storePut(STORE_ARTICLES,a).then(()=>loadState()).catch(()=>{});
  state.detailGuid=guid;
  if(push){history.pushState({reader:true},'',location.href.split('#')[0]+'#article='+encodeURIComponent(guid));state.detailHistory=true}
  renderDetail(a)
}
function closeDetail(){
  modalRoot.innerHTML='';state.detailGuid=null;
  if(state.detailHistory){state.detailHistory=false;history.replaceState({},'',location.href.split('#')[0])}
}
function renderDetail(a){
  const ans=Object.entries(a.answers||{});
  modalRoot.innerHTML='<div class="modal-backdrop" id="detailBackdrop"><article class="modal detail-page"><div class="modal-head"><div><div class="article-kicker">'+esc(a.category||'其他')+'</div><h2 class="modal-title">'+esc(a.title||'无标题')+'</h2></div><button class="close" id="detailClose">×</button></div>'+
    '<div class="detail-meta"><span>'+esc(a.stock?.name||'综合')+(a.stock?.code?' · '+esc(a.stock.code):'')+'</span><span>'+esc(fmtTime(a.publishedAt))+'</span></div>'+
    (a.summary?'<section class="detail-section"><h3>AI总结</h3><div class="summary-box">'+esc(a.summary)+'</div></section>':'')+
    (ans.length?'<section class="detail-section"><h3>结构化信息</h3><div class="answer-list">'+ans.map(([k,v])=>'<div><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join('')+'</div></section>':'')+

    '<section class="detail-section"><h3>RSS原始正文</h3><div class="article-body rss-original-body">'+(a.rawHtml||'<p>无</p>')+'</div></section>'+
    '<section class="detail-section"><h3>操作</h3><div class="detail-actions"><button class="primary" id="detailFav">'+(a.favorite?'取消收藏':'收藏')+'</button></div></section>'+
    '<section class="detail-section"><h3>我的点评</h3><div id="notes">'+(a.notes?.length?a.notes.map(n=>'<div class="note-item"><div class="note-time">'+esc(fmtTime(n.time))+'</div><div class="note-text">'+esc(n.text)+'</div></div>').join(''):'<div class="settings-empty">还没有点评</div>')+'</div><textarea id="noteInput" class="note-input" placeholder="记录自己的判断或备注"></textarea><button class="secondary" id="saveNote">保存点评</button></section>'+
  '</article></div>';
  document.getElementById('detailClose').onclick=()=>{history.back()};
  document.getElementById('detailBackdrop').addEventListener('click',e=>{if(e.target.id==='detailBackdrop')history.back()});
  document.getElementById('detailFav').onclick=async()=>{a.favorite=!a.favorite;await storePut(STORE_ARTICLES,a);await loadState();renderDetail(a);render();};
  document.getElementById('saveNote').onclick=async()=>{const v=document.getElementById('noteInput').value.trim();if(!v)return;const x=Array.isArray(a.notes)?a.notes:[];x.push({time:now(),text:v});a.notes=x;await storePut(STORE_ARTICLES,a);await loadState();renderDetail(a);toast('点评已保存')};
}
function openExternal(url){
  const u=normalizeHttps(url);if(!u)return;
  if(window.AndroidNative?.openUrl){window.AndroidNative.openUrl(u);return}
  window.open(u,'_blank','noopener,noreferrer');
}
window.addEventListener('popstate',()=>{if(state.detailGuid){state.detailHistory=false;modalRoot.innerHTML='';state.detailGuid=null}});
if(location.hash.startsWith('#article=')){const guid=decodeURIComponent(location.hash.slice(9));setTimeout(()=>openDetail(guid,false),200)}

async function exportBackup(){
  const payload={backupVersion:BACKUP_VERSION,app:'zizhi-rss-reader',exportedAt:now(),sources:state.sources,articles:state.articles};
  const json=JSON.stringify(payload,null,2);
  const filename='zizhi-rss-backup-'+new Date().toISOString().slice(0,10)+'.json';
  if(window.AndroidNative?.saveTextFile){window.__rssSaveResult=(ok,msg)=>toast(msg);window.AndroidNative.saveTextFile(filename,json);return}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
async function importBackupText(json){
  try{
    const p=JSON.parse(json);if(p?.app!=='zizhi-rss-reader'||Number(p.backupVersion)!==BACKUP_VERSION)throw new Error('备份文件版本不兼容');
    await clearStores();
    for(const s of Array.isArray(p.sources)?p.sources:[])await storePut(STORE_SOURCES,s);
    for(const a of Array.isArray(p.articles)?p.articles:[])if(a?.guid)await storePut(STORE_ARTICLES,a);
    await loadState();render();toast('备份恢复完成')
  }catch(e){toast('恢复失败：'+(e.message||e))}
}
window.restoreBackupText=importBackupText;
importFileEl.onchange=async()=>{const f=importFileEl.files?.[0];if(f)await importBackupText(await f.text());importFileEl.value=''}

async function checkUpdate(){
  const progress=document.getElementById('updateProgress'),desc=document.getElementById('updateDesc'),pct=document.getElementById('updatePct'),fill=document.getElementById('updateFill');
  if(progress)progress.style.display='block';
  if(desc)desc.textContent='读取更新清单…';
  let manifest=null,last='';
  for(const base of UPDATE_MANIFEST_URLS){
    try{
      const text=await fetchText(base,'update');manifest=JSON.parse(text);break
    }catch(e){last=e.message||String(e)}
  }
  if(!manifest){if(desc)desc.textContent='更新清单读取失败：'+last;toast('更新清单读取失败');return}
  const v=String(manifest.version||''),code=Number(manifest.versionCode||0);
  if(!/^(?:3|4)\.\d+\.\d+$/.test(v)||!Number.isSafeInteger(code)){if(desc)desc.textContent='更新清单版本无效';return}
  if(code<=APP_VERSION_CODE){if(desc)desc.textContent='当前已是最新版本';if(pct)pct.textContent='100%';if(fill)fill.style.width='100%';return}
  const urls=[manifest.apk_url,...(manifest.apk_urls||[])].filter(Boolean);
  const url=urls.find(u=>{try{const x=new URL(u),p=x.pathname;return x.protocol==='https:'&&((x.hostname==='raw.githubusercontent.com'&&/^\/baibiaowang\/GPT\/releases\/.*\/app\.apk$/.test(p))||(x.hostname==='github.com'&&/^\/baibiaowang\/GPT\/releases\/download\/v.*\/zizhi-rss-.*\.apk$/.test(p)))}catch{return false}});
  if(!url){desc.textContent='没有可信 APK 地址';return}
  if(desc)desc.textContent='发现 '+v+'，开始下载…';
  if(window.AndroidNative?.downloadApk){
    window.__rssApkDownloadProgress=(p,s,m)=>{if(pct)pct.textContent=p+'%';if(fill)fill.style.width=p+'%';if(desc)desc.textContent=m||s||'下载中…'};
    window.__rssApkDownloadComplete=()=>{if(desc)desc.textContent='下载完成，准备安装…'};
    window.__rssApkDownloadFailed=m=>{if(desc)desc.textContent='更新失败：'+m;toast('更新失败')};
    window.AndroidNative.downloadApk(url,'zizhi-rss-'+v+'.apk',String(manifest.sha256||''),Number(manifest.apk_size||0));
  }else{
    desc.innerHTML='新版本 '+esc(v)+'：<a href="'+esc(url)+'" target="_blank" rel="noopener">下载 APK</a>';
  }
}

async function loadState(){
  state.sources=await storeGetAll(STORE_SOURCES);state.articles=await storeGetAll(STORE_ARTICLES);
  state.sources.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
}
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;state.search='';state.category='';state.date='';render()});
document.getElementById('refreshButton').onclick=refreshAll;
init();
async function init(){try{await loadState();render()}catch(e){app.innerHTML=emptyState('初始化失败',e.message||String(e));}}

// RSS 3.0.12 clean-core build marker
