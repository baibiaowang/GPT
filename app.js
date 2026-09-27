const APP_VERSION='3.0.9',APP_VERSION_CODE=3009,
UPDATE_MANIFEST_URLS=[
  'https://raw.githubusercontent.com/baibiaowang/GPT/main/update.json',
  'https://cdn.jsdelivr.net/gh/baibiaowang/GPT@main/update.json',
  'https://fastly.jsdelivr.net/gh/baibiaowang/GPT@main/update.json',
  'https://gcore.jsdelivr.net/gh/baibiaowang/GPT@main/update.json'
];
const DB_NAME='stock-rss-reader',DB_VERSION=1;
const TITLES={subscriptions:'订阅',favorites:'收藏',notes:'点评',settings:'设置'},LOCAL_ID='__local_archive__';
const state={page:'subscriptions',activeSourceId:null,search:'',sources:[],articles:[],modalArticleId:null,modalHistory:false};
const app=document.getElementById('app'),modalRoot=document.getElementById('modalRoot'),toastEl=document.getElementById('toast'),importFileEl=document.getElementById('importFile');

function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('sources'))d.createObjectStore('sources',{keyPath:'id'});if(!d.objectStoreNames.contains('articles'))d.createObjectStore('articles',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function getAll(store){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
async function get(store,key){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function put(store,val){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).put(val);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function del(store,key){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).delete(key);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function clearDB(){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(['sources','articles'],'readwrite');t.objectStore('sources').clear();t.objectStore('articles').clear();t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function sha(input){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=v=>{if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
const onlyText=h=>{const d=document.createElement('div');d.innerHTML=h||'';return d.textContent||d.innerText||''};
const toast=m=>{toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove('show'),3000)};
const sourceById=id=>state.sources.find(s=>s.id===id);
const countSource=id=>state.articles.filter(a=>a.sourceId===id).length;
const filtered=arr=>{const q=state.search.trim().toLowerCase();return q?arr.filter(a=>[a.title,a.stockName,a.stockCode,a.summary,onlyText(a.content),sourceById(a.sourceId)?.name].some(x=>String(x||'').toLowerCase().includes(q))):arr};

window.addEventListener('popstate',()=>{
  if(state.modalArticleId!==null){
    state.modalArticleId=null;
    state.modalHistory=false;
    modalRoot.innerHTML='';
  }
});
async function init(){
 state.sources=await getAll('sources');state.articles=await getAll('articles');
 state.sources.sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
 if(state.activeSourceId!==LOCAL_ID&&(!state.activeSourceId||!sourceById(state.activeSourceId)))state.activeSourceId=state.sources[0]?.id||null;
 document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;state.search='';render()});
 document.getElementById('refreshButton').onclick=refreshFeeds;
 importFileEl.onchange=importBackup;
 render();
 if('serviceWorker'in navigator){
  navigator.serviceWorker.register('sw.js?v='+encodeURIComponent(APP_VERSION),{updateViaCache:'none'}).then(r=>r.update().catch(()=>{})).catch(()=>{});
}
}
async function articleId(item,source){
 const stable=String(item.guid||item.link||'').trim();
 const fallback=[item.title||'',item.publishedAt||'',item.author||''].join('|').trim()||String(item.summary||item.content||'').slice(0,500);
 return sha(String(source?.id||'')+'|'+(stable||fallback));
}
function absoluteUrl(value,base){
 const v=String(value||'').trim();if(!v)return'';
 try{const u=new URL(v,base);return /^(?:https?):$/i.test(u.protocol)&&u.hostname?u.toString():''}catch{return''}
}
function normalizeHttpsUrl(value){
 const v=String(value||'').trim();if(!v)return'';
 try{const u=new URL(v);return u.protocol==='https:'&&u.hostname?u.toString():''}catch{return''}
}
function cacheBustUrl(value,key='nocache',stamp=Date.now()){
 const v=String(value||'').trim();if(!v)return'';
 try{const u=new URL(v);u.searchParams.set(key,String(stamp));return u.toString()}catch{return v}
}
function isTrustedUpdateUrl(value,version){
 try{
  const u=new URL(String(value||'').trim()),v=String(version||'').trim();
  if(u.protocol!=='https:')return false;
  const host=u.hostname.toLowerCase();
  if(host==='raw.githubusercontent.com')return u.pathname===`/baibiaowang/GPT/apk/releases/${v}/app.apk`;
  if(host==='github.com')return u.pathname===`/baibiaowang/GPT/releases/download/v${v}/zizhi-rss-${v}.apk`;
  return false;
 }catch{return false}
}
function render(){
 document.getElementById('pageTitle').textContent=TITLES[state.page];
 document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));
 if(state.page==='subscriptions')renderSubs();else if(state.page==='favorites')renderCollection(true);else if(state.page==='notes')renderCollection(false);else renderSettings();
}
function toolbar(){return `<div class="toolbar"><input id="searchInput" class="search" placeholder="搜索标题、股票、摘要" value="${esc(state.search)}"/><button class="pill" id="clearSearch">清除</button></div>`}
function empty(message,button='去设置'){return `<div class="empty"><div class="empty-icon">⌁</div><div class="empty-title">${esc(message)}</div><div class="empty-desc">历史文章、收藏与点评都保存在当前设备中。</div><button class="primary" data-empty-action>${button}</button></div>`}
function renderSubs(){
 if(!state.sources.length&&state.articles.length){
   state.activeSourceId=LOCAL_ID;
 }else if(!state.sources.length){
   app.innerHTML=empty('还没有订阅源');app.querySelector('[data-empty-action]').onclick=()=>{state.page='settings';render()};return
 }
 const local=state.activeSourceId===LOCAL_ID,src=local?null:(sourceById(state.activeSourceId)||state.sources[0]);
 if(!local)state.activeSourceId=src.id;
 const base=local?state.articles:state.articles.filter(a=>a.sourceId===src.id),arr=filtered(base);
 const chips=[`<button class="source-chip ${local?'active':''}" data-source="${LOCAL_ID}"><strong>本机归档</strong><span>全部已保存 · ${state.articles.length}</span></button>`].concat(state.sources.map(s=>`<button class="source-chip ${s.id===state.activeSourceId?'active':''}" data-source="${esc(s.id)}"><strong>${esc(s.name)}</strong><span>${s.type==='summary'?'公告总结':'股票公告'} · ${countSource(s.id)}</span></button>`)).join('');
 app.innerHTML=`<div class="section-head"><div><div class="section-title">切换订阅源</div><div class="section-subtitle">${local?'本机所有已抓取文章':state.sources.length+' 个源 · '+countSource(src.id)+' 条已保存'}</div></div></div>
 <div class="source-strip">${chips}</div>${toolbar()}<div id="articleList">${cards(arr)}</div>`;
 app.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{state.activeSourceId=b.dataset.source;state.search='';render()});
 app.querySelector('#searchInput').oninput=e=>{state.search=e.target.value;app.querySelector('#articleList').innerHTML=cards(filtered(local?state.articles:state.articles.filter(a=>a.sourceId===src.id)));wireCards()};
 app.querySelector('#clearSearch').onclick=()=>{state.search='';render()};wireCards();
}
function renderCollection(fav){
 const arr=state.articles.filter(a=>fav?a.favorite:(a.notes||[]).length);
 app.innerHTML=`<div class="section-head"><div><div class="section-title">${fav?'已收藏文章':'已有点评文章'}</div><div class="section-subtitle">${arr.length} 条 · 本机保存</div></div></div>${toolbar()}<div id="articleList">${cards(filtered(arr),true)}</div>`;
 app.querySelector('#searchInput').oninput=e=>{state.search=e.target.value;app.querySelector('#articleList').innerHTML=cards(filtered(arr),true);wireCards()};
 app.querySelector('#clearSearch').onclick=()=>{state.search='';render()};wireCards();
}
function cards(arr){
 if(!arr.length)return empty('这里还没有文章','刷新订阅');
 return arr.slice().sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0)).map(a=>{
  const s=sourceById(a.sourceId),type=s?.type||a.sourceType||'announce',ex=a.summary||onlyText(a.content).slice(0,260),notes=a.notes?.length||0;
  return `<article class="article-card" data-article="${esc(a.id)}"><div class="article-top"><h3 class="article-title">${esc(a.title||'无标题')}</h3><button class="favorite-button ${a.favorite?'active':''}" data-fav="${esc(a.id)}">${a.favorite?'★':'☆'}</button></div>
  <div class="article-meta"><span class="badge ${type==='summary'?'summary':'announce'}">${type==='summary'?'总结':'公告'}</span><span>${esc(s?.name||'历史订阅源')}</span><span>${esc(fmt(a.publishedAt))}</span>${a.stockName?'<span>'+esc(a.stockName)+(a.stockCode?' · '+esc(a.stockCode):'')+'</span>':''}</div>
  ${ex?'<div class="article-excerpt">'+esc(ex)+'</div>':''}<div class="article-actions"><div class="article-left-actions"><button class="small-button" data-open="'+esc(a.id)+'">阅读</button><button class="small-button" data-note="'+esc(a.id)+'">点评'+(notes?' '+notes:'')+'</button></div><span class="section-subtitle">${a.link?'原文':''}</span></div></article>`;
 }).join('')
}
function wireCards(){
 app.querySelectorAll('[data-fav]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const a=state.articles.find(x=>x.id===b.dataset.fav);if(!a)return;a.favorite=!a.favorite;await put('articles',a);state.articles=await getAll('articles');render();toast(a.favorite?'已收藏':'已取消收藏')});
 app.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openArticle(b.dataset.open));
 app.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>openArticle(b.dataset.note,true));
 app.querySelectorAll('.article-card').forEach(c=>c.onclick=e=>{if(!e.target.closest('button'))openArticle(c.dataset.article)});
 app.querySelectorAll('[data-empty-action]').forEach(b=>b.onclick=async()=>{await refreshFeeds()});
}
function renderSettings(){
 app.innerHTML=`<div class="setting-card"><h2>应用</h2><div class="section-subtitle">自制RSS v${APP_VERSION}（${APP_VERSION_CODE}） · 3.0 新版 RSS 模式</div><div class="setting-actions" style="margin-top:12px"><button class="primary" id="checkUpdate">检查更新</button></div><div class="update-progress" id="updateProgress"><div class="update-progress-line"><span id="updateProgressDesc">准备更新…</span><strong id="updatePct">0%</strong></div><div class="update-progress-track"><i id="updateFill"></i></div></div></div>
 <div class="setting-card"><h2>订阅源</h2><div id="sourceRows">${state.sources.length?state.sources.map(s=>`<div class="source-row"><div class="source-info"><strong>${esc(s.name)}</strong><small>${esc(s.url)}</small></div><div class="setting-actions"><button class="small-button" data-edit="${esc(s.id)}">编辑</button><button class="small-button danger" data-delete="${esc(s.id)}">删除</button></div></div>`).join(''):'<div class="section-subtitle">尚未添加订阅源。</div>'}</div><div style="margin-top:12px"><button class="primary" id="addSource">＋ 添加订阅源</button></div></div>
 <div class="setting-card"><h2>本机数据</h2><div class="section-subtitle">正文、摘要、收藏、点评全部保存在当前浏览器的 IndexedDB。删除订阅源不会删除已经保存的文章。</div><div class="setting-actions" style="margin-top:12px"><button class="secondary" id="export">导出本机备份</button><button class="secondary" id="import">导入备份</button><button class="small-button danger" id="clear">清空本机数据</button></div></div>
 <div class="setting-card"><h2>阅读状态</h2><div class="section-subtitle">订阅源：${state.sources.length} 个 · 本机文章：${state.articles.length} 条 · 收藏：${state.articles.filter(a=>a.favorite).length} 条 · 点评：${state.articles.filter(a=>(a.notes||[]).length).length} 条</div></div>`;
 app.querySelector('#addSource').onclick=()=>sourceModal();app.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>sourceModal(sourceById(b.dataset.edit)));app.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteSource(b.dataset.delete));app.querySelector('#export').onclick=exportBackup;app.querySelector('#import').onclick=()=>{if(window.AndroidNative?.openBackupPicker){try{window.AndroidNative.openBackupPicker();return}catch(e){console.warn('原生导入选择器失败',e)}}importFileEl.click()};app.querySelector('#clear').onclick=clearAll;app.querySelector('#checkUpdate').onclick=checkUpdate;
}
function sourceModal(src){
 modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2 class="modal-title">${src?'编辑订阅源':'添加订阅源'}</h2><button class="close" id="close">×</button></div>
 <label class="field"><span>自定义名称</span><input id="sName" placeholder="例如：A股公告" value="${esc(src?.name||'')}"></label>
 <label class="field"><span>RSS / Atom / JSON Feed 地址（仅 HTTPS）</span><input id="sUrl" placeholder="https://example.com/feed.xml" value="${esc(src?.url||'')}"></label>
 <label class="field"><span>内容类型</span><select id="sType"><option value="announce" ${src?.type==='announce'?'selected':''}>股票公告</option><option value="summary" ${src?.type==='summary'?'selected':''}>公告总结</option></select></label>
 <div class="section-subtitle">抓取后文章会保存到本机。以后即使文章从 RSS 消失，已保存的版本仍可阅读。</div><div class="setting-actions" style="margin-top:14px"><button class="primary" id="save">保存并抓取</button><button class="secondary" id="cancel">取消</button></div></div></div>`;
 document.getElementById('close').onclick=closeModal;document.getElementById('cancel').onclick=closeModal;
 document.getElementById('save').onclick=async()=>{const name=document.getElementById('sName').value.trim(),rawUrl=document.getElementById('sUrl').value.trim(),url=normalizeHttpsUrl(rawUrl),type=document.getElementById('sType').value;if(!name||!url)return toast('请填写名称和有效的 HTTPS 地址');const id=src?.id||await sha(url);const record={id,name,url,type:type==='summary'?'summary':'announce',createdAt:src?.createdAt||new Date().toISOString(),lastSyncAt:src?.lastSyncAt||null,lastError:null};await put('sources',record);state.sources=await getAll('sources');state.activeSourceId=id;closeModal();await refreshSource(record);render()};
}
async function deleteSource(id){const s=sourceById(id);if(!s)return;if(!confirm(`删除订阅源“${s.name}”？\n\n只删除订阅配置，不删除已经保存在本机的文章、收藏和点评。`))return;await del('sources',id);state.sources=await getAll('sources');if(state.activeSourceId===id)state.activeSourceId=state.sources[0]?.id||LOCAL_ID;render();toast('订阅源已删除，历史文章仍保留')}
function closeModal(fromHistory=false){const hadHistory=state.modalHistory;state.modalArticleId=null;state.modalHistory=false;modalRoot.innerHTML='';if(hadHistory&&!fromHistory){history.back()}}
async function refreshFeeds(){if(!state.sources.length)return toast('请先添加订阅源');document.getElementById('refreshButton').disabled=true;let failed=0;try{for(const s of state.sources){const ok=await refreshSource(s);if(!ok)failed++}state.sources=await getAll('sources');state.articles=await getAll('articles');render();toast(failed?('刷新完成：'+(state.sources.length-failed)+' 个成功，'+failed+' 个失败'):'订阅刷新完成')}finally{document.getElementById('refreshButton').disabled=false}}
async function fetchFeedText(url){
  if(window.AndroidNative?.fetchFeed&&window.AndroidNative?.readFeedChunk){
    return await new Promise((resolve,reject)=>{
      window.__rssNativeFeedWaiter=(ok,message)=>{
        window.__rssNativeFeedWaiter=null;
        if(!ok){reject(Error(message||'原生读取订阅失败'));return}
        try{
          let out='',offset=0,chunk=131072;
          const decoder=new TextDecoder('utf-8');
          for(;;){
            const b64=AndroidNative.readFeedChunk(offset,chunk);
            if(!b64)break;
            const bin=atob(b64),bytes=new Uint8Array(bin.length);
            for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
            out+=decoder.decode(bytes,{stream:true});
            offset+=bytes.length;
            if(bytes.length<chunk)break;
          }
          out+=decoder.decode();
          resolve(out)
        }catch(e){reject(e)}
      };
      try{AndroidNative.fetchFeed(url)}catch(e){window.__rssNativeFeedWaiter=null;reject(e)}
    });
  }
  const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return await r.text();
}
window.__rssNativeFeedResult=(ok,message)=>{const waiter=window.__rssNativeFeedWaiter;if(typeof waiter==='function')waiter(!!ok,String(message||''))};
async function refreshSource(s){try{const xml=await fetchFeedText(s.url),items=parseFeed(xml,s);if(!items.length)throw Error('订阅源已读取，但未解析出任何文章，请检查 Feed 格式');for(const item of items){const id=await articleId(item,s);let old=await get('articles',id);if(!old){const legacyId=await sha(item.guid||item.link||item.title+'|'+(item.publishedAt||''));const legacy=await get('articles',legacyId);if(legacy?.sourceId===s.id)old=legacy}await put('articles',{...old,...item,id,sourceId:s.id,sourceType:s.type,fetchedAt:new Date().toISOString(),favorite:old?.favorite===true,notes:Array.isArray(old?.notes)?old.notes:[]})}await put('sources',{...s,lastSyncAt:new Date().toISOString(),lastError:null,lastItemCount:items.length});state.articles=await getAll('articles');return true}catch(e){await put('sources',{...s,lastError:String(e.message||e)});toast(s.name+' 抓取失败：'+String(e.message||e));return false}}
function parseFeed(text,s){
 const trimmed=text.replace(/^\uFEFF/,'').trim();
 if(trimmed.startsWith('{')){
   let j;try{j=JSON.parse(trimmed)}catch{throw Error('Feed JSON 解析失败')}
   const items=Array.isArray(j.items)?j.items:Array.isArray(j.entries)?j.entries:Array.isArray(j.articles)?j.articles:Array.isArray(j.data)?j.data:null;
   if(items){
     return items.map(x=>{
       const htmlContent=typeof x.content_html==='string'?x.content_html:(typeof x.contentHtml==='string'?x.contentHtml:'');
       const textContent=String(x.content_text||x.contentText||x.summary||x.description||x.content||'');
       const content=htmlContent?sanitize(htmlContent,s.url):'<p>'+esc(textContent).replace(/\n/g,'<br>')+'</p>';
       const title=x.title||x.name||'无标题',link=absoluteUrl(x.url||x.link||x.external_url||x.externalUrl||'',s.url),guid=x.id||x.guid||x.uid||link||title,publishedAt=x.date_published||x.datePublished||x.published_at||x.publishedAt||x.date_modified||x.updated||'',summary=onlyText(content).replace(/\s+/g,' ').trim().slice(0,700),stock=stockInfo(title+'\n'+summary+'\n'+JSON.stringify(x));
       return {title,link,guid,content:sanitize(content,s.url),summary,publishedAt,author:x.author?.name||x.author?.url||x.author||x.creator||'',stockName:x.stockName||x.stock_name||stock.name,stockCode:x.stockCode||x.stock_code||x.symbol||stock.code,sourceId:s.id,sourceType:s.type,extra:x};
     });
   }
 }
 const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('RSS/Atom XML 解析失败');
 let nodes=[...d.getElementsByTagName('item')],atom=false;if(!nodes.length){nodes=[...d.getElementsByTagName('entry')];atom=true}if(!nodes.length){nodes=[...d.getElementsByTagName('article')];atom=false}
 return nodes.map(n=>{
   const title=nodeText(n,'title')||'无标题';
   const link=absoluteUrl(atom?([...n.getElementsByTagName('link')].find(x=>(x.getAttribute('rel')||'alternate')==='alternate')?.getAttribute('href')||[...n.getElementsByTagName('link')][0]?.getAttribute('href')||''):nodeText(n,'link'),s.url);
   const guid=nodeText(n,'guid')||nodeText(n,'id')||link||title;
   const raw=nodeText(n,'content:encoded')||nodeText(n,'content')||nodeText(n,'description')||nodeText(n,'summary');
   const extra=getLocalFields(n);
   const preferred=extra.summary||extra.description||extra.content||raw;
   const summary=onlyText(preferred).replace(/\s+/g,' ').trim().slice(0,700);
   const publishedAt=nodeText(n,'pubDate')||nodeText(n,'published')||nodeText(n,'updated')||extra.published||extra.updated||'';
   const author=extra.author||extra.creator||nodeText(n,'dc:creator')||nodeText(n,'author');
   const code=extra.symbol||extra.stockCode||extra.code||'',name=extra.stockName||extra.company||extra.name||'';
   const stock=stockInfo(title+'\\n'+summary);
   return {title,link,guid,content:sanitize(raw,s.url),summary,publishedAt,author,stockName:name||stock.name,stockCode:code||stock.code,sourceId:s.id,sourceType:s.type,extra};
 });
}
function getLocalFields(n){
 const out={};
 for(const el of n.children){
   const key=String(el.localName||el.tagName||'').replace(/^.*:/,'');
   const value=el.textContent?.trim();
   if(key&&value&&!out[key])out[key]=value;
 }
 return out;
}
function nodeText(n,q){
 if(q.includes(':')){
   const direct=n.getElementsByTagName(q);
   if(direct[0]?.textContent)return direct[0].textContent.trim();
   const local=q.split(':').pop(),ns=n.getElementsByTagNameNS('*',local);
   if(ns[0]?.textContent)return ns[0].textContent.trim();
 }
 return n.querySelector(q)?.textContent?.trim()||'';
}
function sanitize(html,baseUrl){const w=document.createElement('div');w.innerHTML=html||'';w.querySelectorAll('script,style,iframe,object,embed,form,base,meta,link,title,svg,math').forEach(x=>x.remove());w.querySelectorAll('*').forEach(x=>[...x.attributes].forEach(a=>{const n=a.name.toLowerCase(),v=a.value||'';if(n.startsWith('on')||n==='srcdoc'||n==='style')x.removeAttribute(a.name);if(n==='href'){if(!/^(?:https?:|mailto:|tel:|#)/i.test(v))x.removeAttribute(a.name);else if(baseUrl&&!/^(?:mailto:|tel:|#)/i.test(v))a.value=absoluteUrl(v,baseUrl)}if(n==='src'){if(!/^https?:/i.test(v))x.removeAttribute(a.name);else if(baseUrl&&/^https?:/i.test(v))a.value=absoluteUrl(v,baseUrl)}}));w.querySelectorAll('a[href]').forEach(a=>{a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer')});return w.innerHTML}
function stockInfo(t){return{code:t.match(/(?<!\d)(?:00|30|60|68|83|87|43)\d{4}(?!\d)/)?.[0]||'',name:t.match(/(?:股票简称|证券简称)[：:]?\s*([\u4e00-\u9fa5A-Za-z0-9·.-]{2,20})/)?.[1]||''}}

function openArticle(id,focusNote=false){
 const a=state.articles.find(x=>x.id===id);if(!a)return toast('本机找不到这篇文章');const s=sourceById(a.sourceId);
 if(!state.modalHistory||state.modalArticleId!==id){state.modalArticleId=id;state.modalHistory=true;history.pushState({rssArticle:id},'', '#article='+encodeURIComponent(id));}
 modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2 class="modal-title">${esc(a.title)}</h2><button class="close" id="close">×</button></div>
 <div class="article-meta"><span class="badge ${a.sourceType==='summary'?'summary':'announce'}">${a.sourceType==='summary'?'总结':'公告'}</span><span>${esc(s?.name||'历史订阅源')}</span><span>${esc(fmt(a.publishedAt))}</span></div>
 <div class="article-body">${a.content||'<p>'+esc(a.summary||'没有可显示的正文')+'</p>'}</div>
 <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><button class="secondary" id="fav">${a.favorite?'★ 已收藏':'☆ 收藏'}</button>${a.link?'<button class="primary" id="original">打开原文</button>':''}</div>
 <div class="setting-card" style="margin-top:14px;padding:14px"><h2>我的点评</h2><textarea id="noteText" placeholder="记录你的观察、后续验证点或交易计划…" style="width:100%;min-height:110px;border:1px solid var(--line);border-radius:13px;padding:11px;resize:vertical"></textarea><div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="primary" id="saveNote">保存点评</button></div><div class="note-list">${(a.notes||[]).slice().reverse().map(n=>'<div class="note-item"><div class="note-time">'+esc(fmt(n.createdAt))+'</div><div class="note-text">'+esc(n.text)+'</div></div>').join('')||'<div class="section-subtitle">还没有点评。</div>'}</div></div>
 </div></div>`;
 document.getElementById('close').onclick=closeModal;
 document.getElementById('fav').onclick=async()=>{a.favorite=!a.favorite;await put('articles',a);state.articles=await getAll('articles');openArticle(id,focusNote);render()};
 if(a.link)document.getElementById('original').onclick=()=>{if(window.AndroidNative?.openUrl){try{window.AndroidNative.openUrl(a.link);return}catch(e){}}window.open(a.link,'_blank','noopener,noreferrer')};
 document.getElementById('saveNote').onclick=async()=>{const t=document.getElementById('noteText').value.trim();if(!t)return toast('点评内容不能为空');a.notes=a.notes||[];a.notes.push({id:crypto.randomUUID?.()||String(Date.now()),text:t,createdAt:new Date().toISOString()});await put('articles',a);state.articles=await getAll('articles');openArticle(id);toast('点评已保存')};
 if(focusNote)document.getElementById('noteText').focus();
}

function updateMessage(message){const e=document.getElementById('updateProgressDesc');if(e)e.textContent=String(message||'')}
function updateProgress(percent,message){const p=document.getElementById('updateProgress'),f=document.getElementById('updateFill'),t=document.getElementById('updatePct');if(p)p.style.display='block';if(f)f.style.width=Math.max(0,Math.min(100,Number(percent)||0))+'%';if(t)t.textContent=Math.round(Number(percent)||0)+'%';if(message)updateMessage(message)}
window.__rssSaveResult=(ok,message)=>{const waiter=window.__rssSaveWaiter;if(typeof waiter==='function'){window.__rssSaveWaiter=null;waiter(!!ok,String(message||''))}};
window.__rssApkDownloadProgress=(percent,status,message)=>updateProgress(percent,message||'正在下载更新…');
window.__rssApkDownloadComplete=()=>{const waiter=window.__rssApkWaiter;window.__rssApkWaiter=null;if(typeof waiter==='function'){waiter(true,'');return}updateProgress(100,'APK 已下载完成，正在打开安装界面。');toast('下载完成，正在安装')};
window.__rssApkDownloadFailed=message=>{const waiter=window.__rssApkWaiter;window.__rssApkWaiter=null;if(typeof waiter==='function'){waiter(false,String(message||'APK 下载失败'));return}updateMessage(String(message||'APK 下载失败'));toast(String(message||'APK 下载失败'))};
window.__rssUpdateResult=(ok,message)=>{const waiter=window.__rssUpdateWaiter;if(typeof waiter==='function'){window.__rssUpdateWaiter=null;waiter(!!ok,String(message||''))}};
function validateUpdateManifest(m){
 const version=String(m?.version||'').trim();
 const versionCode=Number(m?.versionCode||0);
 const sha256=String(m?.sha256||'').trim().toLowerCase();
 const size=Number(m?.apk_size||0);
 const rawUrls=[];if(m?.apk_url)rawUrls.push(m.apk_url);if(Array.isArray(m?.apk_urls))rawUrls.push(...m.apk_urls);
 const urls=[...new Set(rawUrls.map(x=>String(x||'').trim()).filter(Boolean))];
 if(String(m?.repo||'')!=='baibiaowang/GPT')throw Error('更新清单来源仓库不受信任');
 if(!/^3\.\d+\.\d+$/.test(version)||!Number.isSafeInteger(versionCode)||versionCode<3000)throw Error('更新清单版本无效');
 if(!/^[0-9a-f]{64}$/.test(sha256))throw Error('更新清单 SHA-256 无效');
 if(!Number.isSafeInteger(size)||size<=1024*1024)throw Error('更新清单 APK 大小无效');
 if(!urls.length||urls.some(u=>!isTrustedUpdateUrl(u,version)))throw Error('更新清单包含不受信任或与版本不匹配的 APK 地址');
 return {version,versionCode,sha256,size,urls};
}
function validateBackupPayload(p){
 if(p?.schema!==1||!Array.isArray(p.sources)||!Array.isArray(p.articles))throw Error('备份格式不正确');
 if(p.sources.length>1000||p.articles.length>50000)throw Error('备份条目数量超出安全上限');
 for(const src of p.sources){
   if(!src||typeof src!=='object'||typeof src.id!=='string'||typeof src.name!=='string'||typeof src.url!=='string')throw Error('备份中的订阅源数据无效');
   if(src.id.length>500||src.name.length>200||src.url.length>4096||!normalizeHttpsUrl(src.url))throw Error('备份中的订阅源数据无效');
 }
 for(const a of p.articles){
   if(!a||typeof a!=='object'||typeof a.id!=='string'||typeof a.title!=='string')throw Error('备份中的文章数据无效');
   if(a.id.length>500||a.title.length>500)throw Error('备份中的文章字段过长');
   if(typeof a.content==='string'&&a.content.length>8*1024*1024)throw Error('备份中的单篇正文过大');
 }
 return p;
}
function decodeUtf8Base64(value){
 const bin=atob(String(value||'').replace(/\s+/g,''));
 const bytes=new Uint8Array(bin.length);
 for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
 return new TextDecoder('utf-8',{fatal:false}).decode(bytes);
}
function parseUpdateManifestText(text){
 let value=String(text??'').replace(/^\uFEFF/,'').trim();
 for(let depth=0;depth<3;depth++){
   if(value.startsWith('{')||value.startsWith('[')){
     const parsed=JSON.parse(value);
     if(parsed&&typeof parsed==='object'&&parsed.encoding==='base64'&&typeof parsed.content==='string'){
       value=decodeUtf8Base64(parsed.content).replace(/^\uFEFF/,'').trim();
       continue;
     }
     return parsed;
   }
   const compact=value.replace(/\s+/g,'');
   if(!compact||compact.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact))break;
   let decoded='';
   try{decoded=decodeUtf8Base64(compact).replace(/^\uFEFF/,'').trim()}catch{break}
   if(!(decoded.startsWith('{')||decoded.startsWith('[')))break;
   value=decoded;
 }
 throw Error('更新清单不是有效 JSON');
}
async function fetchUpdateManifest(){
  const errors=[];
  for(const endpoint of UPDATE_MANIFEST_URLS){
    if(window.AndroidNative?.fetchUpdateManifest&&window.AndroidNative?.readUpdateChunk){
      try{
        const result=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{window.__rssUpdateWaiter=null;reject(Error('原生读取更新清单超时'))},15000);
          window.__rssUpdateWaiter=(ok,message)=>{
            clearTimeout(timer);window.__rssUpdateWaiter=null;
            ok?resolve():reject(Error(message||'更新清单读取失败'));
          };
          try{AndroidNative.fetchUpdateManifest(endpoint+'?nocache='+Date.now())}catch(e){clearTimeout(timer);window.__rssUpdateWaiter=null;reject(e)}
        });
        let raw='',offset=0,chunk=131072;
        const decoder=new TextDecoder('utf-8');
        for(;;){
          const b64=AndroidNative.readUpdateChunk(offset,chunk);
          if(!b64)break;
          const bin=atob(b64),bytes=new Uint8Array(bin.length);
          for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
          raw+=decoder.decode(bytes,{stream:true});offset+=bytes.length;
          if(bytes.length<chunk)break;
        }
        raw+=decoder.decode();
        if(!raw.trim())throw Error('更新清单为空');
        return parseUpdateManifestText(raw);
      }catch(e){errors.push('native '+endpoint+': '+String(e?.message||e))}
    }
    try{
      const endpointUrl=cacheBustUrl(endpoint,'nocache',Date.now());
      const response=await fetch(endpointUrl,{cache:'no-store',headers:{Accept:'application/json,text/plain,*/*'}});
      if(!response.ok)throw Error('HTTP '+response.status);
      const raw=await response.text();
      if(!raw.trim())throw Error('更新清单为空');
      return parseUpdateManifestText(raw);
    }catch(e){errors.push('web '+endpoint+': '+String(e?.message||e))}
  }
  throw Error('更新清单读取失败：'+errors.join('；').slice(0,1800));
}
async function checkUpdate(){
  const button=document.getElementById('checkUpdate');if(button)button.disabled=true;updateProgress(0,'正在检查最新版本…');
  try{
    const m=await fetchUpdateManifest();
    const validated=validateUpdateManifest(m),remoteCode=validated.versionCode,remoteName=validated.version;
    if(!Number.isSafeInteger(remoteCode)||remoteCode<=0)throw Error('更新清单 versionCode 无效');
    if(remoteCode<=APP_VERSION_CODE){updateMessage('当前已是最新版本 '+APP_VERSION+'（'+APP_VERSION_CODE+'）');toast('当前已是最新版本');return}
    updateMessage('发现新版本 '+remoteName);if(!confirm('发现新版本 '+remoteName+'，现在下载并安装？'))return;
    const list=validated.urls;
    if(window.AndroidNative?.downloadApk){
      const expected=validated.sha256,expectedSize=validated.size;
      let last='APK 下载失败';
      for(const url of list){try{updateMessage('正在尝试下载：'+url.replace(/^https:\/\//,''));await new Promise((resolve,reject)=>{window.__rssApkWaiter=(ok,message)=>{window.__rssApkWaiter=null;ok?resolve():reject(Error(message||'APK 下载失败'))};window.AndroidNative.downloadApk(url,'zizhi-rss-'+remoteName+'.apk',expected,expectedSize)});return}catch(e){last=String(e?.message||e)}}
      throw Error(last);
    }
    const webUrl=cacheBustUrl(list[0]);window.open(webUrl,'_blank','noopener,noreferrer');updateMessage('已打开 APK 下载地址');
  }catch(e){updateMessage('检查更新失败：'+String(e?.message||e));toast('检查更新失败')}finally{if(button)button.disabled=false}
}

async function exportBackup(){
 const payload={schema:1,exportedAt:new Date().toISOString(),sources:await getAll('sources'),articles:await getAll('articles')};
 const content=JSON.stringify(payload,null,2);
 const filename='stock-rss-backup-'+new Date().toISOString().slice(0,10)+'.json';
 if(window.AndroidNative?.saveTextFile){
  try{
    await new Promise((resolve,reject)=>{
      window.__rssSaveWaiter=(ok,message)=>{window.__rssSaveWaiter=null;ok?resolve():reject(Error(message||'备份保存失败'))};
      try{window.AndroidNative.saveTextFile(filename,content)}catch(e){window.__rssSaveWaiter=null;reject(e)}
    });
    toast('备份已保存到 下载 / 自制RSS');return;
  }catch(e){toast('备份导出失败：'+String(e?.message||e));return}
 }
 const blob=new Blob([content],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('本机备份已导出')
}
async function restoreBackupText(text){
 try{
  const rawText=String(text||'');
  if(rawText.length>64*1024*1024)throw Error('备份文件过大，超过 64 MB 限制');
  const p=validateBackupPayload(JSON.parse(rawText));
  const sourceMap=new Map();
  for(const raw of p.sources){
    const url=normalizeHttpsUrl(raw.url);if(!url)throw Error('备份中的订阅源 URL 无效');
    const src={...raw,id:String(raw.id),name:String(raw.name).slice(0,200),url,type:raw.type==='summary'?'summary':'announce'};
    sourceMap.set(src.id,src);
    await put('sources',src);
  }
  for(const raw of p.articles){
    const src=sourceMap.get(String(raw.sourceId));
    const safeContent=sanitize(String(raw.content||''),src?.url||'');
    const safeLink=absoluteUrl(raw.link||'',src?.url||'');
    const notes=Array.isArray(raw.notes)?raw.notes.filter(n=>n&&typeof n==='object'&&typeof n.text==='string').slice(-500).map(n=>({
      id:String(n.id||crypto.randomUUID?.()||String(Date.now())),
      text:String(n.text).slice(0,5000),
      createdAt:String(n.createdAt||'')
    })):[];
    const article={
      ...raw,
      id:String(raw.id),
      title:String(raw.title).slice(0,500),
      link:safeLink,
      content:safeContent,
      summary:String(raw.summary||onlyText(safeContent)).replace(/\s+/g,' ').trim().slice(0,700),
      favorite:raw.favorite===true,
      notes,
      sourceId:String(raw.sourceId||'')
    };
    await put('articles',article);
  }
  state.sources=await getAll('sources');
  state.articles=await getAll('articles');
  state.activeSourceId=state.activeSourceId||state.sources[0]?.id||null;
  render();
  toast('备份已合并导入');
  return true;
 }catch(e){toast('导入失败：'+String(e?.message||e));return false}
}
window.restoreBackupText=restoreBackupText;
async function importBackup(){
 const f=importFileEl.files?.[0];if(!f)return;
 try{await restoreBackupText(await f.text())}finally{importFileEl.value=''}
}
async function clearAll(){if(!confirm('确定清空本机所有订阅、文章、收藏和点评吗？\n\n此操作不可撤销。'))return;await clearDB();try{window.AndroidNative?.clearLocalFiles?.()}catch{}state.sources=[];state.articles=[];state.activeSourceId=null;state.search='';closeModal(true);render();toast('本机数据已清空')}
window.addEventListener('popstate',()=>{if(state.modalHistory){state.modalHistory=false;state.modalArticleId=null;modalRoot.innerHTML=''}});
init().catch(e=>{console.error(e);app.innerHTML='<div class="empty"><div class="empty-title">读取本机数据失败</div><div class="empty-desc">'+esc(e.message||e)+'</div></div>'});
