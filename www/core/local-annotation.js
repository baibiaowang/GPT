(function(g){
'use strict';

class LocalAnnotation{
  constructor(storage){
    this.storage=storage||localStorage;
    this.favKey='table.annotations.favorites.v2';
    this.commentKey='table.annotations.comments.v2';
  }

  load(key,fallback){
    try{return JSON.parse(this.storage.getItem(key)||'')||fallback}catch(e){return fallback}
  }

  save(key,value){
    this.storage.setItem(key,JSON.stringify(value));
  }

  id(tableId,rowId){
    return String(tableId)+'::'+String(rowId);
  }

  snapshot(table,row){
    return JSON.parse(JSON.stringify({
      rowId:row.rowId,
      cells:Array.isArray(row.cells)?row.cells:[],
      columns:Array.isArray(table?.columns)?table.columns.map(column=>({
        columnId:column.columnId,
        key:column.key,
        label:column.label,
        type:column.type,
        visible:column.visible,
        valueCatalog:Array.isArray(column.valueCatalog)?column.valueCatalog:[]
      })):[],
      tableName:String(table?.tableName||'表格')
    }));
  }

  favorite(table,row){
    const data=this.load(this.favKey,{});
    const id=this.id(table.tableId,row.rowId);
    if(data[id]){
      delete data[id];
      this.save(this.favKey,data);
      return false;
    }
    data[id]={
      tableId:String(table.tableId),
      rowId:String(row.rowId),
      tableName:String(table.tableName||'表格'),
      snapshot:this.snapshot(table,row),
      savedAt:new Date().toISOString()
    };
    this.save(this.favKey,data);
    return true;
  }

  isFavorite(table,row){
    const data=this.load(this.favKey,{});
    return !!data[this.id(table.tableId,row.rowId)];
  }

  favorites(tableId){
    return Object.values(this.load(this.favKey,{})).filter(entry=>String(entry.tableId)===String(tableId));
  }

  allFavorites(){
    return Object.values(this.load(this.favKey,{}));
  }

  setComment(table,row,text){
    const data=this.load(this.commentKey,{});
    const id=this.id(table.tableId,row.rowId);
    const comment=String(text||'').trim();
    if(comment){
      data[id]={
        tableId:String(table.tableId),
        rowId:String(row.rowId),
        tableName:String(table.tableName||'表格'),
        comment,
        snapshot:this.snapshot(table,row),
        updatedAt:new Date().toISOString()
      };
    }else{
      delete data[id];
    }
    this.save(this.commentKey,data);
    return data[id]||null;
  }

  comments(tableId){
    return Object.values(this.load(this.commentKey,{})).filter(entry=>String(entry.tableId)===String(tableId));
  }

  allComments(){
    return Object.values(this.load(this.commentKey,{}));
  }

  comment(tableId,rowId){
    return this.load(this.commentKey,{})[this.id(tableId,rowId)]||null;
  }

  restore(favorites,comments){
    this.save(this.favKey,Object.fromEntries((Array.isArray(favorites)?favorites:[]).map(entry=>[
      this.id(entry.tableId,entry.rowId),entry
    ])));
    this.save(this.commentKey,Object.fromEntries((Array.isArray(comments)?comments:[]).map(entry=>[
      this.id(entry.tableId,entry.rowId),entry
    ])));
  }

  clear(){
    this.storage.removeItem(this.favKey);
    this.storage.removeItem(this.commentKey);
  }
}

g.LocalAnnotation=LocalAnnotation;
})(window);
