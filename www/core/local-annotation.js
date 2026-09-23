(function(g){
'use strict';

class LocalAnnotation{
  constructor(storage){
    this.storage=storage||localStorage;
    this.favKey='table.annotations.favorites.v1';
    this.commentKey='table.annotations.comments.v1';
    this.dbName='table-annotations-v2';
    this.store='kv';
    this.mem={favorites:{},comments:{}};
    this.ready=this.init();
  }

  readLegacy(key){
    try{return JSON.parse(this.storage.getItem(key)||'')||{}}catch(e){return{}}
  }

  openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(this.dbName,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(this.store))req.result.createObjectStore(this.store)};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDB 打开失败'));
    });
  }

  async readBucket(db,key){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(this.store,'readonly');
      const req=tx.objectStore(this.store).get(key);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }

  async init(){
    const legacyFav=this.readLegacy(this.favKey);
    const legacyComments=this.readLegacy(this.commentKey);
    try{
      const db=await this.openDb();
      const [fav,comments]=await Promise.all([
        this.readBucket(db,'favorites'),
        this.readBucket(db,'comments')
      ]);
      if(fav||comments){
        this.mem.favorites=(fav&&typeof fav==='object')?fav:{};
        this.mem.comments=(comments&&typeof comments==='object')?comments:{};
      }else if(Object.keys(legacyFav).length||Object.keys(legacyComments).length){
        this.mem.favorites=legacyFav;
        this.mem.comments=legacyComments;
        await this.persist();
      }
      db.close();
    }catch(e){
      this.mem.favorites=legacyFav;
      this.mem.comments=legacyComments;
    }
  }

  async persist(){
    try{
      const db=await this.openDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(this.store,'readwrite');
        tx.objectStore(this.store).put(this.mem.favorites,'favorites');
        tx.objectStore(this.store).put(this.mem.comments,'comments');
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error);
        tx.onabort=()=>reject(tx.error||new Error('IndexedDB 写入中止'));
      });
      db.close();
    }catch(e){
      try{
        this.storage.setItem(this.favKey,JSON.stringify(this.mem.favorites));
        this.storage.setItem(this.commentKey,JSON.stringify(this.mem.comments));
      }catch(ignore){}
    }
  }

  id(tableId,rowId){
    return String(tableId)+'::'+String(rowId);
  }

  snapshot(table,row){
    return JSON.parse(JSON.stringify({
      rowId:String(row?.rowId||''),
      cells:Array.isArray(row?.cells)?row.cells:[],
      columns:Array.isArray(table?.columns)?table.columns.map(column=>({
        columnId:column.columnId,
        key:column.key,
        label:column.label,
        type:column.type,
        visible:column.visible
      })):[],
      tableName:String(table?.tableName||'表格')
    }));
  }

  snapshotTable(entry){
    return {
      tableId:String(entry?.tableId||'saved-table'),
      tableName:String(entry?.tableName||entry?.snapshot?.tableName||'已保存表格'),
      columns:Array.isArray(entry?.snapshot?.columns)?entry.snapshot.columns:[],
      rows:[entry?.snapshot||entry?.row].filter(Boolean)
    };
  }

  favorite(table,row){
    const id=this.id(table.tableId,row.rowId);
    if(this.mem.favorites[id]){
      delete this.mem.favorites[id];
      void this.persist();
      return false;
    }
    const saved=this.snapshot(table,row);
    this.mem.favorites[id]={
      tableId:String(table.tableId),
      rowId:String(row.rowId),
      tableName:String(table.tableName||'表格'),
      snapshot:saved,
      columns:saved.columns,
      savedAt:new Date().toISOString()
    };
    void this.persist();
    return true;
  }

  isFavorite(table,row){
    return !!this.mem.favorites[this.id(table.tableId,row.rowId)];
  }

  favorites(tableId){
    return Object.values(this.mem.favorites).filter(entry=>String(entry.tableId)===String(tableId));
  }

  allFavorites(){
    return Object.values(this.mem.favorites);
  }

  setComment(table,row,text){
    const id=this.id(table.tableId,row.rowId);
    const comment=String(text||'').trim();
    if(comment){
      const saved=this.snapshot(table,row);
      const old=this.mem.comments[id];
      this.mem.comments[id]={
        tableId:String(table.tableId),
        rowId:String(row.rowId),
        tableName:String(table.tableName||'表格'),
        comment,
        snapshot:saved,
        columns:saved.columns,
        updatedAt:new Date().toISOString()
      };
      if(old?.createdAt&&!this.mem.comments[id].createdAt)this.mem.comments[id].createdAt=old.createdAt;
    }else{
      delete this.mem.comments[id];
    }
    void this.persist();
    return this.mem.comments[id]||null;
  }

  comments(tableId){
    return Object.values(this.mem.comments).filter(entry=>String(entry.tableId)===String(tableId));
  }

  allComments(){
    return Object.values(this.mem.comments);
  }

  comment(tableId,rowId){
    return this.mem.comments[this.id(tableId,rowId)]||null;
  }

  rebindTable(table,identityFn){
    const rebindBucket=(bucket)=>{
      const result={};
      const rowsById=new Map((table.rows||[]).map(row=>[String(row.rowId),row]));
      const rowsByIdentity=new Map();
      for(const row of table.rows||[]){
        try{rowsByIdentity.set(String(identityFn(table,row)),row)}catch(e){}
      }

      for(const entry of Object.values(bucket)){
        let row=null;
        if(String(entry.tableId)===String(table.tableId)){
          row=rowsById.get(String(entry.rowId))||null;
        }
        if(!row){
          try{
            const savedRow=entry.snapshot||entry.row;
            const identityRow=Object.assign({},savedRow,{rowId:'',id:''});
            row=rowsByIdentity.get(String(identityFn(this.snapshotTable(entry),identityRow)))||null;
          }catch(e){}
        }

        if(row){
          const saved=this.snapshot(table,row);
          const next=Object.assign({},entry,{
            tableId:String(table.tableId),
            rowId:String(row.rowId),
            tableName:String(table.tableName||'表格'),
            snapshot:saved,
            columns:saved.columns
          });
          result[this.id(table.tableId,row.rowId)]=next;
        }else{
          result[this.id(entry.tableId,entry.rowId)]=entry;
        }
      }
      return result;
    };

    this.mem.favorites=rebindBucket(this.mem.favorites);
    this.mem.comments=rebindBucket(this.mem.comments);
    void this.persist();
  }

  restore(favorites,comments){
    this.mem.favorites=Object.fromEntries((Array.isArray(favorites)?favorites:[]).map(entry=>[
      this.id(entry.tableId,entry.rowId),entry
    ]));
    this.mem.comments=Object.fromEntries((Array.isArray(comments)?comments:[]).map(entry=>[
      this.id(entry.tableId,entry.rowId),entry
    ]));
    void this.persist();
  }

  clear(){
    this.mem={favorites:{},comments:{}};
    void this.persist();
    try{
      this.storage.removeItem(this.favKey);
      this.storage.removeItem(this.commentKey);
    }catch(e){}
  }
}

g.LocalAnnotation=LocalAnnotation;
})(window);
