(function(g){
'use strict';

const APP={
  version:'2.1.6',
  versionCode:2106,
  defaultSource:'https://stocks-txt-file.app.workbuddy.host/stocks.txt',
  updateSources:[
    'https://raw.githubusercontent.com/baibiaowang/GPT/main/update.json',
    'https://cdn.jsdelivr.net/gh/baibiaowang/GPT@main/update.json',
    'https://fastly.jsdelivr.net/gh/baibiaowang/GPT@main/update.json',
    'https://gcore.jsdelivr.net/gh/baibiaowang/GPT@main/update.json'
  ],
  releaseApk:'https://raw.githubusercontent.com/baibiaowang/GPT/apk/releases/2.1.6/app.apk'
};

const LS={
  urls:'sj.urls.v4',
  key:'sj.activation.v4',
  layout:'table.layout.v3',
  filters:'table.filters.v1'
};

const IDB={
  db:'stockjudge-gpt',
  store:'kv',
  cacheKey:'generic.table.cache.v3'
};

const state={
  table:null,
  currentRow:null,
  currentTable:null,
  query:'',
  page:'home',
  detailPushed:false,
  typeColumn:'',
  conclusionColumn:'',
  typeValue:'',
  conclusionValue:'',
  kind:'',
  savedEntries:new Map()
};

let annotations=null;

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const clean=v=>String(v==null?'':v).trim();

function toast(message,ms=2200){
  const e=$('toast');
  if(!e)return;
  e.textContent=message;
  e.classList.add('show');
  clearTimeout(e._timer);
  e._timer=setTimeout(()=>e.classList.remove('show'),ms);
}

function hash(text){
  let h=2166136261;
  const s=String(text??'');
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0).toString(16).padStart(8,'0');
}

function scalar(value){
  if(value==null)return '';
  if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);
  try{return JSON.stringify(value)}catch(e){return String(value)}
}

function hexBytes(hex){
  const out=new Uint8Array(32);
  for(let i=0;i<32;i++)out[i]=parseInt(hex.slice(i*2,i*2+2),16);
  return out;
}

function b64Bytes(value){
  let text=String(value??'').replace(/^\uFEFF/,'').trim();
  text=text.replace(/^data:[^,]*,/i,'');
  text=text.replace(/^['"]|['"]$/g,'');
  if(text.slice(0,4)==='SJ01'){
    const raw=new TextEncoder().encode(text);
    return raw;
  }
  text=text.replace(/-/g,'+').replace(/_/g,'/');
  text=text.replace(/\s+/g,'');
  text=text.replace(/[^A-Za-z0-9+/=]/g,'');
  while(text.length%4)text+='=';
  const binary=atob(text);
  const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
}

function getKey(){
  const key=clean(localStorage.getItem(LS.key)||'');
  if(!/^[0-9a-fA-F]{64}$/.test(key))throw new Error('请先输入64位十六进制激活码');
  return key;
}

function getSourceUrls(){
  const value=String(localStorage.getItem(LS.urls)||'').trim();
  const urls=value.split(/\s*\n\s*/).map(clean).filter(Boolean);
  return urls.length?urls:[APP.defaultSource];
}

async function decryptSJ01(encoded){
  const bytes=b64Bytes(encoded);
  if(bytes.length<33)throw new Error('SJ01 密文过短');
  if(String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='SJ01')throw new Error('数据格式不是 SJ01');
  if(bytes[4]!==3)throw new Error('SJ01 数据版本不是 0x03');
  const iv=bytes.slice(5,17);
  const cipher=bytes.slice(17);
  const cryptoKey=await crypto.subtle.importKey('raw',hexBytes(getKey()),{name:'AES-GCM'},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},cryptoKey,cipher);
  const text=new TextDecoder().decode(plain);
  let payload;
  try{payload=JSON.parse(text)}catch(e){throw new Error('解密成功，但明文不是 JSON')}
  if(!payload||typeof payload!=='object')throw new Error('明文 JSON 不是对象');
  if(Number(payload.meta?.schema)!==3)throw new Error('明文 JSON schema 必须为 3');
  if(!payload.layout||!Array.isArray(payload.layout.list_columns)||!Array.isArray(payload.layout.detail_columns)){
    throw new Error('schema v3 缺少完整 layout.list_columns / detail_columns');
  }
  if(!payload.display||typeof payload.display!=='object')throw new Error('schema v3 缺少 display');
  if(!payload.judge_tables||typeof payload.judge_tables!=='object')throw new Error('schema v3 缺少 judge_tables');
  if(!payload.announcements||typeof payload.announcements!=='object')throw new Error('schema v3 缺少 announcements');
  if(!Array.isArray(payload.records))throw new Error('schema v3 缺少 records');
  return payload;
}

function openIdb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(IDB.db,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(IDB.store))req.result.createObjectStore(IDB.store)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

function idbGet(key){
  return openIdb().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(IDB.store,'readonly');
    const req=tx.objectStore(IDB.store).get(key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  }));
}

function idbSet(key,value){
  return openIdb().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(IDB.store,'readwrite');
    tx.objectStore(IDB.store).put(value,key);
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error);
  }));
}

function idbDelete(key){
  return openIdb().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(IDB.store,'readwrite');
    tx.objectStore(IDB.store).delete(key);
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error);
  }));
}

function loadFilterPrefs(){
  let prefs={};
  try{prefs=JSON.parse(localStorage.getItem(LS.filters)||'{}')||{}}catch(e){}
  if(!state.table)return;
  const t=prefs[state.table.tableId+'::type']||{};
  const c=prefs[state.table.tableId+'::conclusion']||{};
  state.typeColumn=String(t.columnId||state.typeColumn||'');
  state.typeValue=String(t.valueId||'');
  state.conclusionColumn=String(c.columnId||state.conclusionColumn||'');
  state.conclusionValue=String(c.valueId||'');
}

function saveFilter(kind,columnId,valueId){
  let prefs={};
  try{prefs=JSON.parse(localStorage.getItem(LS.filters)||'{}')||{}}catch(e){}
  if(!state.table)return;
  prefs[state.table.tableId+'::'+kind]={columnId:String(columnId||''),valueId:String(valueId||'')};
  localStorage.setItem(LS.filters,JSON.stringify(prefs));
}

function readCatalogRegistry(){
  let registry={};
  try{registry=JSON.parse(localStorage.getItem('table.columnIds.v1')||'{}')||{}}catch(e){}
  return registry;
}

function writeCatalogRegistry(registry){
  try{localStorage.setItem('table.columnIds.v1',JSON.stringify(registry))}catch(e){}
}

function schemaColumns(payload){
  const layout=payload.layout&&typeof payload.layout==='object'?payload.layout:{};
  const list=Array.isArray(layout.list_columns)?layout.list_columns:[];
  const detail=Array.isArray(layout.detail_columns)?layout.detail_columns:[];
  const all=[];
  const seen=new Map();

  for(const source of [list,detail]){
    for(const raw of source){
      const key=clean(raw?.key)||clean(raw?.label);
      if(!key)continue;
      if(!seen.has(key)){
        const column={key,label:clean(raw?.label)||key,type:clean(raw?.type)||'text',visible:false};
        seen.set(key,column);
        all.push(column);
      }
      const column=seen.get(key);
      if(source===list)column.visible=true;
      if(source===detail&&raw?.type)column.type=clean(raw.type);
    }
  }

  if(!all.length&&payload.records[0]){
    const first=payload.records[0];
    const object=first?.columns&&typeof first.columns==='object'?first.columns:first;
    for(const key of Object.keys(object||{})){
      if(['rowId','id','cells','columns'].includes(key))continue;
      all.push({key,label:key,type:'text',visible:true});
    }
  }

  if(!all.length)throw new Error('schema v3 没有可识别的表头');
  return all;
}

function recordValue(record,column){
  const direct=record&&typeof record==='object'?record:{};
  const nested=direct.columns&&typeof direct.columns==='object'?direct.columns:{};
  for(const key of [column.key,column.label]){
    if(key&&Object.prototype.hasOwnProperty.call(direct,key)&&direct[key]!=null)return scalar(direct[key]);
    if(key&&Object.prototype.hasOwnProperty.call(nested,key)&&nested[key]!=null)return scalar(nested[key]);
  }
  return '';
}

function assignColumnIds(tableId,defs){
  const registry=readCatalogRegistry();
  const map=registry[tableId]||{};
  let max=Object.values(map).reduce((m,v)=>Math.max(m,Number(v)||0),0);
  const columns=[];
  for(const def of defs){
    let n=Number(map[def.key]||0);
    if(!n){
      n=++max;
      map[def.key]=n;
    }
    columns.push({
      columnId:String(n).padStart(3,'0'),
      key:def.key,
      label:def.label,
      type:def.type,
      visible:!!def.visible,
      valueCatalog:[]
    });
  }
  registry[tableId]=map;
  writeCatalogRegistry(registry);
  columns.sort((a,b)=>Number(a.columnId)-Number(b.columnId));
  return columns;
}

function makeRowId(record,values){
  const explicit=clean(record?.rowId)||clean(record?.id);
  return explicit||'R-'+hash(values.join('\u241f'));
}

function buildTable(payload,url){
  if(Number(payload?.meta?.schema)!==3)throw new Error('schema v3 校验失败');
  const defs=schemaColumns(payload);
  const source=clean(payload.meta?.source)||clean(url)||'table';
  const stableName=clean(payload.meta?.table_id||payload.meta?.table_name||payload.meta?.title)||'table';
  const tableId='table-'+hash(source+'|'+stableName);
  const columns=assignColumnIds(tableId,defs);
  const rows=[];

  for(const record of payload.records){
    const values=columns.map(column=>recordValue(record,column));
    if(values.every(value=>!clean(value)))continue;
    rows.push({
      rowId:makeRowId(record,values),
      cells:columns.map((column,index)=>new CellModel({
        columnId:column.columnId,
        value:values[index],
        type:column.type
      })),
      recordData:Object.fromEntries(
        Object.entries(record||{}).filter(([key])=>!columns.some(column=>column.key===key))
      )
    });
  }

  if(!rows.length)throw new Error('schema v3 没有有效数据行');

  const table=new TableModel({
    tableId,
    tableName:clean(payload.meta?.table_name||payload.meta?.title)||'表格',
    columns,
    rows,
    meta:Object.assign({},payload.meta,{source_url:url||'',schema:3}),
    extensions:Object.fromEntries(
      Object.entries(payload||{}).filter(([key])=>!['meta','records'].includes(key))
    )
  });

  new ColumnManager(table).refreshCatalog();
  return table;
}

function getCell(row,column){
  return (row?.cells||[]).find(cell=>String(cell.columnId)===String(column.columnId))||{value:'',valueId:''};
}

function getColumns(table=state.table){
  return table?.columns||[];
}

function getVisibleColumns(table=state.table){
  if(!table)return[];
  let prefs={};
  try{prefs=JSON.parse(localStorage.getItem(LS.layout)||'{}')||{}}catch(e){}
  const saved=Array.isArray(prefs[table.tableId])?prefs[table.tableId]:[];
  const ids=saved.length?saved:table.columns.filter(column=>column.visible).map(column=>column.columnId);
  const fallback=ids.length?ids:table.columns.slice(0,Math.min(3,table.columns.length)).map(column=>column.columnId);
  return fallback.map(id=>table.getColumn(id)).filter(Boolean);
}
function displayValue(value,mode='list'){
  const text=String(value??'');
  if(mode==='list' && /^\d{4}-\d{2}-\d{2}$/.test(text))return text.slice(5);
  return text;
}
function displayColor(table,value,column){
  if(column?.type!=='status')return '';
  const colors=table?.extensions?.display?.status_color;
  const candidate=colors&&colors[String(value)];
  return /^#[0-9A-Fa-f]{3,8}$/.test(String(candidate||''))?String(candidate):'';
}

function selectDefaultFilterColumns(){
  const columns=getColumns();
  if(!columns.length)return;
  if(!state.typeColumn||!state.table.getColumn(state.typeColumn))state.typeColumn=columns[0].columnId;
  if(!state.conclusionColumn||!state.table.getColumn(state.conclusionColumn))state.conclusionColumn=columns[columns.length-1].columnId;
}

function rowTableHtml(rows,columns=getVisibleColumns(),table=state.table,mode='normal'){
  if(!rows.length)return'<div class="empty">暂无数据</div>';
  const head=columns.map(column=>'<th><span class="cid">'+esc(column.columnId)+'</span><span>'+esc(column.label)+'</span></th>').join('');
  const body=rows.map(row=>{
    const key=table?.tableId?esc(table.tableId):'';
    return '<tr class="data-row" data-row-id="'+esc(row.rowId)+'" data-table-id="'+key+'" data-mode="'+esc(mode)+'">'+
      columns.map(column=>{
        const raw=getCell(row,column).value;
        const color=displayColor(table,raw,column);
        const style=color?' style="color:'+esc(color)+';font-weight:800"':'';
        return '<td title="'+esc(raw)+'"'+style+'>'+esc(displayValue(raw,'list')||'—')+'</td>';
      }).join('')+
    '</tr>';
  }).join('');
  return '<div class="table-scroll"><table class="data-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}

function renderHome(){
  const q=clean(state.query).toLowerCase();
  const rows=state.table?state.table.rows.filter(row=>!q||(row.cells||[]).some(cell=>String(cell.value??'').toLowerCase().includes(q))):[];
  if($('topTitle'))$('topTitle').textContent='共 '+rows.length+' 行';
  if($('dataNote'))$('dataNote').textContent=state.table?(state.kind==='cache'?'缓存数据':'实时数据'):'未加载';
  if($('homeList'))$('homeList').innerHTML=state.table?rowTableHtml(rows):'<div class="empty">请先加载数据</div>';
}

function renderFilter(kind){
  if(!state.table)return;
  selectDefaultFilterColumns();
  loadFilterPrefs();
  selectDefaultFilterColumns();
  const columnId=kind==='type'?state.typeColumn:state.conclusionColumn;
  const tabs=$(kind==='type'?'typeTabs':'conclusionTabs');
  const list=$(kind==='type'?'typesList':'conclusionList');
  const column=state.table.getColumn(columnId);
  if(!tabs||!list)return;
  const values=column?.valueCatalog||[];
  let valueId=kind==='type'?state.typeValue:state.conclusionValue;
  if(!values.some(value=>value.valueId===valueId))valueId=values[0]?.valueId||'';
  if(kind==='type')state.typeValue=valueId;else state.conclusionValue=valueId;
  saveFilter(kind,columnId,valueId);
  tabs.innerHTML=values.map(value=>
    '<button class="tab '+(value.valueId===valueId?'on':'')+'" data-filter-kind="'+kind+'" data-value-id="'+esc(value.valueId)+'">'+
    '<span>'+esc(value.valueId)+'</span><span>'+esc(value.label)+'</span><b>'+value.count+'</b></button>'
  ).join('');
  const selected=values.find(value=>value.valueId===valueId);
  list.innerHTML=selected?rowTableHtml(FilterEngine.byValueId(state.table,columnId,valueId),getVisibleColumns(),state.table):'<div class="empty">该表头暂无非空取值</div>';
}

function renderTypes(){renderFilter('type')}
function renderConclusions(){renderFilter('conclusion')}

function entryColumns(entry){
  if(Array.isArray(entry?.columns))return entry.columns;
  if(Array.isArray(entry?.snapshot?.columns))return entry.snapshot.columns;
  return [];
}

function entryTable(entry){
  const tableId=String(entry?.tableId||'saved-table');
  const columns=entryColumns(entry);
  const row=entry?.snapshot||entry?.row;
  if(!row)return null;
  return new TableModel({
    tableId,
    tableName:entry?.tableName||'已保存表格',
    columns,
    rows:[row],
    meta:{schema:3,source_url:'',local_saved:true},
    extensions:{}
  });
}

function renderSaved(kind){
  const target=$(kind==='favorites'?'favList':'commentList');
  if(!target)return;

  const entries=kind==='favorites'?annotations.allFavorites():annotations.allComments();

  state.savedEntries.clear();
  for(const entry of entries)state.savedEntries.set(String(entry.tableId)+'::'+String(entry.rowId),entry);

  if(!entries.length){
    target.innerHTML='<div class="empty">'+(kind==='favorites'?'还没有收藏':'暂无点评')+'</div>';
    return;
  }

  const groups=new Map();
  for(const entry of entries){
    const key=String(entry.tableId||'saved');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(entry);
  }

  let html='';
  for(const [tableId,group] of groups){
    const table=state.table?.tableId===tableId?state.table:entryTable(group[0]);
    const rows=group.map(entry=>entry.snapshot||entry.row).filter(Boolean);
    const title=groups.size>1?'<div class="saved-group-title">表格 '+esc(tableId)+'</div>':'';
    html+=title+rowTableHtml(rows,getVisibleColumns(table),table,'saved');
  }
  target.innerHTML=html;
}

function renderSettings(){
  const sec=$('page-settings');
  if(!sec)return;

  const columns=getColumns();
  const visible=new Set(getVisibleColumns().map(column=>column.columnId));
  const options=columns.map(column=>
    '<label class="column-item">'+
      '<input type="checkbox" data-display-column="'+esc(column.columnId)+'" '+(visible.has(column.columnId)?'checked':'')+'>'+
      '<span class="column-main"><span class="column-name">'+esc(column.columnId)+' '+esc(column.label)+'</span>'+
      '<span class="column-meta">'+(column.valueCatalog?.length||0)+' 种实际取值</span></span>'+
    '</label>'
  ).join('');

  const typeId=state.typeColumn&&state.table?.getColumn(state.typeColumn)?state.typeColumn:(columns[0]?.columnId||'');
  const conclusionId=state.conclusionColumn&&state.table?.getColumn(state.conclusionColumn)?state.conclusionColumn:(columns[columns.length-1]?.columnId||'');

  sec.innerHTML=
    '<div class="section-title">设置</div>'+
    '<div class="card display-settings-card">'+
      '<div class="card-hd"><span>显示设置</span><span class="sub">展示与筛选配置</span></div>'+
      '<div class="setting-item">'+
        '<div class="setting-title">首页展示表头</div>'+
        '<div class="setting-desc">表头使用固定编号；勾选后决定首页展示哪些字段。</div>'+
        '<div id="displayColumns">'+(columns.length?options:'<div class="empty compact">加载表格后可设置</div>')+'</div>'+
        '<div class="setting-actions"><button class="sbtn primary" id="saveDisplayColumns">保存首页显示</button></div>'+
      '</div>'+
      '<div class="setting-item">'+
        '<div class="setting-title">类型 / 结论默认表头</div>'+
        '<div class="setting-desc">这里只选择默认筛选表头；类型与结论页面本身不再显示手动选择器。</div>'+
        '<div class="filter-settings">'+
          '<label>类型<select id="typeColumnSetting">'+columns.map(column=>'<option value="'+esc(column.columnId)+'">'+esc(column.columnId)+' '+esc(column.label)+'</option>').join('')+'</select></label>'+
          '<label>结论<select id="conclusionColumnSetting">'+columns.map(column=>'<option value="'+esc(column.columnId)+'">'+esc(column.columnId)+' '+esc(column.label)+'</option>').join('')+'</select></label>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-hd"><span>数据</span></div>'+
      '<div class="setting-item"><div class="setting-title">数据源</div><div class="setting-desc">直接读取 SJ01 加密数据，并由你输入的密钥解密为 schema v3 表格。</div><div class="setting-actions"><button class="sbtn primary" id="reloadData">重新加载</button><button class="sbtn" id="configureSource">配置地址</button><button class="sbtn" id="configureKey">输入激活码</button></div></div>'+
      '<div class="setting-item"><div class="setting-title">备份</div><div class="setting-desc">保存当前表格、首页展示、筛选选择、收藏和点评。</div><div class="setting-actions"><button class="sbtn primary" id="exportBackup">导出</button><button class="sbtn" id="restoreBackup">恢复</button><button class="sbtn" id="clearData">清空</button></div></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-hd"><span>应用</span></div>'+
      '<div class="setting-item"><div class="setting-title">应用更新</div><div class="setting-desc" id="updateDesc">当前版本 '+APP.version+'（'+APP.versionCode+'）</div><div class="setting-actions"><button class="sbtn primary" id="checkUpdate">检查更新</button></div><div id="updateProgress" class="update-progress"><div class="update-progress-top"><span id="updateProgressText">准备下载…</span><span id="updateProgressPct">0%</span></div><div class="update-progress-bar"><div id="updateProgressFill" class="update-progress-fill"></div></div></div></div>'+
      '<div class="setting-item"><div class="setting-title">数据状态</div><div class="setting-desc" id="dataStatus">'+(state.table?(state.table.rows.length+' 行 · '+columns.length+' 个表头'):'尚未加载')+'</div></div>'+
    '</div>';

  if(!state.table){
    $('typeColumnSetting').innerHTML='<option value="">加载数据后设置</option>';
    $('conclusionColumnSetting').innerHTML='<option value="">加载数据后设置</option>';
  }else{
    $('typeColumnSetting').value=typeId;
    $('conclusionColumnSetting').value=conclusionId;
  }

  $('saveDisplayColumns')?.addEventListener('click',()=>{
    if(!state.table){toast('请先加载数据');return}
    const ids=[...document.querySelectorAll('[data-display-column]:checked')].map(input=>input.dataset.displayColumn);
    if(!ids.length){toast('至少选择一个表头');return}
    let prefs={};
    try{prefs=JSON.parse(localStorage.getItem(LS.layout)||'{}')||{}}catch(e){}
    prefs[state.table.tableId]=ids;
    localStorage.setItem(LS.layout,JSON.stringify(prefs));
    renderHome();
    renderSettings();
    toast('首页展示已保存');
  });

  $('typeColumnSetting')?.addEventListener('change',event=>{
    state.typeColumn=event.target.value;
    state.typeValue='';
    saveFilter('type',state.typeColumn,'');
    renderTypes();
  });

  $('conclusionColumnSetting')?.addEventListener('change',event=>{
    state.conclusionColumn=event.target.value;
    state.conclusionValue='';
    saveFilter('conclusion',state.conclusionColumn,'');
    renderConclusions();
  });

  $('reloadData')?.addEventListener('click',()=>loadData(false));
  $('configureSource')?.addEventListener('click',sourceSheet);
  $('configureKey')?.addEventListener('click',keySheet);
  $('exportBackup')?.addEventListener('click',exportBackup);
  $('restoreBackup')?.addEventListener('click',restoreBackup);
  $('clearData')?.addEventListener('click',clearData);
  $('checkUpdate')?.addEventListener('click',checkUpdate);
}

function pageTitle(page){
  if(page==='home')return state.table?'共 '+state.table.rows.length+' 行':'表格';
  return ({types:'类型',conclusions:'结论',comments:'点评',favorites:'收藏',settings:'设置'})[page]||'表格';
}

function switchPage(page){
  if($('detail')?.classList.contains('show'))closeDetail();
  state.page=page;
  document.querySelectorAll('.page').forEach(section=>section.classList.toggle('on',section.id==='page-'+page));
  document.querySelectorAll('#bottomNav button').forEach(button=>button.classList.toggle('on',button.dataset.page===page));
  if($('topTitle'))$('topTitle').textContent=pageTitle(page);
  if($('searchBar'))$('searchBar').classList.toggle('hidden',page!=='home');
  window.scrollTo(0,0);
}

function openDetail(row,table=state.table){
  if(!row||!table)return;
  state.currentRow=row;
  state.currentTable=table;
  const columns=getColumns(table);
  const first=columns[0]?getCell(row,columns[0]).value:'当前行';
  $('detailTitle').textContent='行详情';
  $('detailHero').innerHTML=
    '<div class="hero"><h1>'+esc(first||'当前行')+'</h1>'+
    '<div class="meta"><span class="tag">rowId '+esc(row.rowId)+'</span><span class="tag">'+esc(table.tableName)+'</span></div>'+
    '<div class="detail-actions"><button id="detailFav" class="sbtn '+(annotations.isFavorite(table,row)?'primary':'')+'">'+(annotations.isFavorite(table,row)?'已收藏':'收藏')+'</button><button id="detailCopy" class="sbtn primary">复制整行</button></div></div>';

  const details=columns.map(column=>
    '<div class="standard-cell"><div class="standard-label"><span class="cid">'+esc(column.columnId)+'</span><span>'+esc(column.label)+'</span></div><div class="standard-value '+(column.type==='longtext'?'summary':'')+'">'+esc(getCell(row,column).value||'—')+'</div></div>'
  ).join('');

  const savedComment=(annotations.comment(table,row.rowId)||{}).comment||'';
  $('detailBody').innerHTML=
    '<div class="card"><div class="card-hd"><span>完整行数据</span><span class="sub">'+columns.length+' 个表头</span></div>'+details+'</div>'+
    '<div class="card"><div class="card-hd"><span>我的点评</span></div><div class="comment-editor"><textarea id="detailComment" placeholder="写下点评…">'+esc(savedComment)+'</textarea><button id="saveDetailComment" class="sbtn primary">保存点评</button></div></div>';

  $('detail').classList.add('show');
  if(!state.detailPushed){
    history.pushState({detail:true,row:row.rowId,table:table.tableId},'','?row='+encodeURIComponent(row.rowId));
    state.detailPushed=true;
  }

  $('detailFav').onclick=()=>{
    const marked=annotations.favorite(table,row);
    renderAll();
    openDetail(state.currentRow,state.currentTable);
    toast(marked?'已收藏':'已取消收藏');
  };
  $('detailCopy').onclick=()=>{
    copyText(columns.map(column=>column.columnId+' '+column.label+': '+getCell(row,column).value).join('\n')).then(()=>toast('整行已复制')).catch(()=>toast('复制失败'));
  };
  $('saveDetailComment').onclick=()=>{
    annotations.setComment(table,row,$('detailComment').value);
    renderAll();
    openDetail(state.currentRow,state.currentTable);
    toast('点评已保存');
  };
}

function closeDetail(){
  $('detail').classList.remove('show');
  state.currentRow=null;
  state.currentTable=null;
  state.detailPushed=false;
  const url=new URL(location.href);
  url.search='';
  history.replaceState({root:true},'',url.pathname+url.hash);
}

function renderExternalRow(tableId,rowId){
  const entry=state.savedEntries.get(String(tableId)+'::'+String(rowId));
  if(entry){
    const table=state.table?.tableId===String(tableId)?state.table:entryTable(entry);
    if(table)openDetail(entry.snapshot||entry.row,table);
    return true;
  }
  return false;
}

function openSourceSheet(){
  openSheet('数据源',
    '<div class="note">每行一个 HTTPS 地址。留空恢复默认数据源。<br>'+esc(APP.defaultSource)+'</div>'+
    '<div class="sheet-body"><textarea id="sourceInput" placeholder="'+esc(APP.defaultSource)+'">'+esc(localStorage.getItem(LS.urls)||'')+'</textarea></div>'+
    '<div class="sheet-actions"><button class="sbtn" id="cancelSource">取消</button><button class="sbtn primary" id="saveSource">保存并加载</button></div>',
    ()=>{
      $('cancelSource').onclick=closeSheet;
      $('saveSource').onclick=()=>{
        const value=clean($('sourceInput').value);
        if(value)localStorage.setItem(LS.urls,value);else localStorage.removeItem(LS.urls);
        closeSheet();
        loadData(false);
      };
    }
  );
}

function openKeySheet(){
  openSheet('激活码',
    '<div class="note">SJ01 使用 AES-256-GCM。请输入自己的 64 位十六进制激活码。</div>'+
    '<div class="sheet-body"><input id="keyInput" type="text" value="'+esc(localStorage.getItem(LS.key)||'')+'" placeholder="64位十六进制激活码"></div>'+
    '<div class="sheet-actions"><button class="sbtn primary" id="saveKey">保存并加载</button></div>',
    ()=>{
      $('saveKey').onclick=()=>{
        const key=clean($('keyInput').value);
        if(!/^[0-9a-fA-F]{64}$/.test(key)){toast('激活码必须是64位十六进制');return}
        localStorage.setItem(LS.key,key);
        closeSheet();
        loadData(false);
      };
    }
  );
}

function exportBackup(){
  if(!state.table){toast('暂无表格可备份');return}
  const payload={
    kind:'table-converter-backup',
    version:1,
    exported_at:new Date().toISOString(),
    table:state.table.toJSON(),
    layout:(()=>{try{return JSON.parse(localStorage.getItem(LS.layout)||'{}')}catch(e){return{}}})(),
    filters:(()=>{try{return JSON.parse(localStorage.getItem(LS.filters)||'{}')}catch(e){return{}}})(),
    favorites:annotations.favorites(state.table.tableId),
    comments:annotations.comments(state.table.tableId)
  };
  const text=JSON.stringify(payload,null,2);
  const name='table-backup-'+new Date().toISOString().slice(0,10)+'.json';
  if(g.AndroidNative?.saveTextFile){
    AndroidNative.saveTextFile(name,text);
    toast('备份已导出');
    return;
  }
  const anchor=document.createElement('a');
  anchor.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  anchor.download=name;
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(anchor.href),500);
  toast('备份已导出');
}

function applyBackup(payload){
  if(!payload?.table)throw new Error('备份中没有表格');
  state.table=new TableModel(payload.table);
  new ColumnManager(state.table).refreshCatalog();
  annotations.restore(payload.favorites||[],payload.comments||[]);
  localStorage.setItem(LS.layout,JSON.stringify(payload.layout||{}));
  localStorage.setItem(LS.filters,JSON.stringify(payload.filters||{}));
  state.kind='local';
  loadFilterPrefs();
  renderAll();
  switchPage('home');
  toast('备份已恢复');
}

function restoreBackup(){
  if(g.AndroidNative?.openBackupPicker){
    AndroidNative.openBackupPicker();
    return;
  }
  const input=document.createElement('input');
  input.type='file';
  input.accept='.json,application/json';
  input.onchange=()=>{
    const file=input.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{applyBackup(JSON.parse(reader.result))}
      catch(error){toast('恢复失败：'+error.message,2800)}
    };
    reader.readAsText(file);
  };
  input.click();
}

g.restoreBackupText=function(text){
  try{applyBackup(JSON.parse(text))}
  catch(error){toast('恢复失败：'+error.message,2800)}
};

async function clearData(){
  if(!confirm('确定清空本地表格、收藏和点评吗？数据源地址与激活码保留。'))return;
  try{await idbDelete(IDB.cacheKey)}catch(e){}
  localStorage.removeItem(LS.layout);
  localStorage.removeItem(LS.filters);
  localStorage.removeItem('table.columnIds.v1');
  localStorage.removeItem('table.valueCatalog.v1');
  try{annotations.clear()}catch(e){}
  state.table=null;
  state.currentRow=null;
  state.currentTable=null;
  renderAll();
  switchPage('settings');
  toast('本地数据已清空');
}

async function fetchDataSource(url){
  if(g.AndroidNative?.fetchDataSource&&g.AndroidNative?.readDataSourceChunk){
    await new Promise((resolve,reject)=>{
      g.__tableNativeDataWaiter=(ok,message)=>{
        g.__tableNativeDataWaiter=null;
        ok?resolve():reject(new Error(message||'原生网络请求失败'));
      };
      try{AndroidNative.fetchDataSource(url)}
      catch(error){g.__tableNativeDataWaiter=null;reject(error)}
    });
    let text='',offset=0;
    const chunk=196608;
    for(;;){
      const part=AndroidNative.readDataSourceChunk(offset,chunk);
      if(!part)break;
      text+=part;
      offset+=part.length;
      if(part.length<chunk)break;
    }
    if(!text)throw new Error('数据文件为空');
    return decryptSJ01(text);
  }

  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return decryptSJ01(await response.text());
}

g.__tableNativeDataSourceResult=(ok,message)=>{
  const waiter=g.__tableNativeDataWaiter;
  if(typeof waiter==='function')waiter(!!ok,String(message||''));
};

async function loadData(silent=false){
  const key=clean(localStorage.getItem(LS.key)||'');
  if(!/^[0-9a-fA-F]{64}$/.test(key)){
    renderSettings();
    switchPage('settings');
    if($('dataStatus'))$('dataStatus').textContent='请先输入64位十六进制激活码';
    return;
  }

  let cached=null;
  try{
    const saved=await idbGet(IDB.cacheKey);
    if(saved?.tableId){
      cached=new TableModel(saved);
      new ColumnManager(cached).refreshCatalog();
      state.table=cached;
      state.kind='cache';
      loadFilterPrefs();
      renderAll();
    }
  }catch(e){}

  let lastError='';

  for(const url of getSourceUrls()){
    try{
      const payload=await fetchDataSource(url);
      const table=buildTable(payload,url);
      state.table=table;
      state.kind='remote';
      state.currentRow=null;
      state.currentTable=null;
      state.typeValue='';
      state.conclusionValue='';
      loadFilterPrefs();
      await idbSet(IDB.cacheKey,table.toJSON());
      renderAll();
      switchPage('home');
      if(silent)toast('数据已加载 · SJ01 / schema v3');
      return;
    }catch(error){
      lastError=url.replace(/^https?:\/\//,'').slice(0,55)+' → '+error.message;
    }
  }

  if(cached){
    switchPage('home');
    toast('联网更新失败，继续显示缓存',2600);
    return;
  }

  renderSettings();
  switchPage('settings');
  if($('dataStatus'))$('dataStatus').textContent='数据加载失败：'+lastError;
  toast('数据加载失败：'+lastError,3200);
}

async function fetchUpdateManifest(url){
  if(g.AndroidNative?.fetchUpdateManifest&&g.AndroidNative?.readUpdateChunk){
    await new Promise((resolve,reject)=>{
      g.__tableNativeUpdateWaiter=(ok,message)=>{
        g.__tableNativeUpdateWaiter=null;
        ok?resolve():reject(new Error(message||'更新清单读取失败'));
      };
      try{AndroidNative.fetchUpdateManifest(url)}
      catch(error){g.__tableNativeUpdateWaiter=null;reject(error)}
    });
    let text='',offset=0;
    const chunk=65536;
    for(;;){
      const part=AndroidNative.readUpdateChunk(offset,chunk);
      if(!part)break;
      text+=part;
      offset+=part.length;
      if(part.length<chunk)break;
    }
    if(!text)throw new Error('更新清单为空');
    return JSON.parse(text);
  }

  const response=await fetch(url+'?t='+Date.now(),{
    cache:'no-store',
    headers:{Accept:'application/json'}
  });
  if(!response.ok)throw new Error('HTTP '+response.status);
  return response.json();
}

g.__tableNativeUpdateResult=(ok,message)=>{
  const waiter=g.__tableNativeUpdateWaiter;
  if(typeof waiter==='function')waiter(!!ok,String(message||''));
};

g.__tableApkDownloadProgress=(percent,status,message)=>{
  const progress=$('updateProgress');
  if(progress)progress.classList.add('show');
  if($('updateProgressText'))$('updateProgressText').textContent=message||'正在下载…';
  if($('updateProgressPct'))$('updateProgressPct').textContent=Math.round(Number(percent)||0)+'%';
  if($('updateProgressFill'))$('updateProgressFill').style.width=Math.max(0,Math.min(100,Number(percent)||0))+'%';
};

g.__tableApkDownloadComplete=()=>{
  const waiter=g.__tableApkDownloadWaiter;
  g.__tableApkDownloadWaiter=null;
  if(typeof waiter==='function'){
    waiter(true,'');
    return;
  }
  if($('updateDesc'))$('updateDesc').textContent='APK 已下载完成，正在打开安装界面。';
  toast('下载完成，正在安装',2400);
};

g.__tableApkDownloadFailed=message=>{
  const text=String(message||'APK 下载失败');
  const waiter=g.__tableApkDownloadWaiter;
  g.__tableApkDownloadWaiter=null;
  if(typeof waiter==='function'){
    waiter(false,text);
    return;
  }
  if($('updateDesc'))$('updateDesc').textContent=text;
  toast(text,3000);
};

function bustApkUrl(url,versionCode){
  const text=String(url||'').trim();
  if(!text)return'';
  const joiner=text.includes('?')?'&':'?';
  return text+joiner+'v='+encodeURIComponent(String(versionCode||''));
}

async function downloadApkWithFallback(urls,remoteName,remoteCode){
  const list=[...new Set((Array.isArray(urls)?urls:[]).map(url=>bustApkUrl(url,remoteCode)).filter(Boolean))];
  if(!list.length)throw new Error('更新清单缺少 APK 下载地址');

  if(!g.AndroidNative?.downloadApk){
    window.open(list[0],'_blank');
    return;
  }

  if($('updateProgress'))$('updateProgress').classList.add('show');
  let lastError='APK 下载失败';
  for(const apk of list){
    try{
      await new Promise((resolve,reject)=>{
        g.__tableApkDownloadWaiter=(ok,message)=>{
          g.__tableApkDownloadWaiter=null;
          ok?resolve():reject(new Error(message||'APK 下载失败'));
        };
        try{
          AndroidNative.downloadApk(apk,'table-converter-'+remoteName+'.apk');
        }catch(error){
          g.__tableApkDownloadWaiter=null;
          reject(error);
        }
      });
      return;
    }catch(error){
      lastError=String(error?.message||error||lastError);
    }
  }
  throw new Error(lastError);
}

async function checkUpdate(){
  const desc=$('updateDesc');
  if(desc)desc.textContent='正在检查最新版本…';
  const errors=[];
  const manifests=[];

  for(const source of APP.updateSources){
    try{
      const manifest=await fetchUpdateManifest(source);
      const remoteCode=Number(manifest?.versionCode||0);
      if(!remoteCode)throw new Error('更新清单缺少 versionCode');
      manifests.push({source,manifest,remoteCode});
    }catch(error){
      errors.push(source.replace(/^https?:\/\//,'').slice(0,50)+' → '+error.message);
    }
  }

  if(!manifests.length){
    const message='检查更新失败：'+errors.join('；');
    if(desc)desc.textContent=message;
    toast('检查更新失败',3000);
    return;
  }

  manifests.sort((a,b)=>b.remoteCode-a.remoteCode);
  const best=manifests[0];
  const manifest=best.manifest;
  const remoteCode=best.remoteCode;

  if(remoteCode>APP.versionCode){
    const remoteName=String(manifest?.version||remoteCode);
    if(desc)desc.textContent='发现新版本 '+remoteName;
    if(!confirm('发现新版本 '+remoteName+'，现在下载并安装？'))return;

    const urls=[];
    if(Array.isArray(manifest?.apk_urls))urls.push(...manifest.apk_urls);
    if(manifest?.apk_url)urls.push(manifest.apk_url);
    urls.push(APP.releaseApk);

    try{
      await downloadApkWithFallback(urls,remoteName,remoteCode);
    }catch(error){
      const message='APK 下载失败：'+String(error?.message||error);
      if(desc)desc.textContent=message;
      toast(message,3200);
    }
    return;
  }

  if(desc)desc.textContent='当前已是最新版本 '+APP.version+'（'+APP.versionCode+'） · '+String(manifest?.published_at||'');
  toast('当前已是最新版本',2200);
}

function copyText(text){
  if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(text);
  const area=document.createElement('textarea');
  area.value=text;
  document.body.appendChild(area);
  area.select();
  let ok=false;
  try{ok=document.execCommand('copy')}catch(e){}
  area.remove();
  return ok?Promise.resolve():Promise.reject(new Error('复制失败'));
}

function closeSheet(){
  $('mask')?.classList.remove('show');
  if($('sheet'))$('sheet').innerHTML='';
}

function openSheet(title,html,bind){
  $('sheet').innerHTML='<div class="sheet-grab"></div><h3>'+esc(title)+'</h3>'+html;
  $('mask').classList.add('show');
  if(bind)bind();
}

function wireEvents(){
  document.querySelectorAll('#bottomNav button').forEach(button=>{
    button.addEventListener('click',()=>switchPage(button.dataset.page));
  });

  $('searchInput')?.addEventListener('input',event=>{
    state.query=event.target.value||'';
    renderHome();
  });

  $('detailBack')?.addEventListener('click',closeDetail);
  $('mask')?.addEventListener('click',event=>{if(event.target===$('mask'))closeSheet()});
  window.addEventListener('popstate',()=>{
    if($('mask')?.classList.contains('show')){closeSheet();return}
    if($('detail')?.classList.contains('show'))closeDetail();
  });

  document.addEventListener('click',event=>{
    const row=event.target.closest('.data-row');
    if(row){
      const tableId=String(row.dataset.tableId||'');
      const rowId=String(row.dataset.rowId||'');
      if(row.dataset.mode==='saved'){
        if(renderExternalRow(tableId,rowId))return;
      }
      const table=state.table;
      const found=table?.tableId===tableId?table.getRow(rowId):null;
      if(found&&table)openDetail(found,table);
      return;
    }

    const tab=event.target.closest('[data-filter-kind]');
    if(tab){
      const kind=tab.dataset.filterKind;
      const valueId=tab.dataset.valueId||'';
      if(kind==='type')state.typeValue=valueId;else state.conclusionValue=valueId;
      saveFilter(kind,kind==='type'?state.typeColumn:state.conclusionColumn,valueId);
      renderFilter(kind);
    }
  });

  window.addEventListener('resize',()=>{
    const top=$('topBar');
    if(top)document.documentElement.style.setProperty('--top-height',Math.ceil(top.getBoundingClientRect().height)+'px');
  });
}

function renderAll(){
  renderHome();
  renderTypes();
  renderConclusions();
  renderSaved('comments');
  renderSaved('favorites');
  renderSettings();
}

function wireInitialLayout(){
  const top=$('topBar');
  if(top)document.documentElement.style.setProperty('--top-height',Math.ceil(top.getBoundingClientRect().height)+'px');
  switchPage(state.page);
}

async function boot(){
  annotations=annotations||new LocalAnnotation(localStorage);
  wireEvents();
  wireInitialLayout();

  const key=clean(localStorage.getItem(LS.key)||'');
  if(!/^[0-9a-fA-F]{64}$/.test(key)){
    renderAll();
    switchPage('settings');
    if($('dataStatus'))$('dataStatus').textContent='请先输入64位十六进制激活码';
    return;
  }

  await loadData(true);
}

g.TableConverterApp={APP,state,boot,loadData,switchPage,openDetail,closeDetail,checkUpdate};

boot();

})(window);
