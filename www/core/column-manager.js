(function(g){
class ColumnManager{
  constructor(table){this.table=table}
  get(id){return this.table.getColumn(id)}
  values(id){const c=this.get(id);return c&&Array.isArray(c.valueCatalog)?c.valueCatalog:[]}
  refreshCatalog(){
    const storage=(g.localStorage&&typeof g.localStorage!=='undefined')?g.localStorage:null;
    let registry={};
    try{registry=JSON.parse(storage?.getItem('table.valueCatalog.v1')||'{}')||{}}catch(e){registry={}}
    const tableKey=String(this.table.tableId||'default-table');
    if(!registry[tableKey])registry[tableKey]={};
    this.table.columns.forEach(c=>{
      const colKey=String(c.columnId);const map=registry[tableKey][colKey]||{};
      let max=Object.values(map).reduce((m,v)=>Math.max(m,Number(String(v).replace(/^V/i,''))||0),0);
      const counts=new Map();
      this.table.rows.forEach(r=>{
        const cell=(r.cells||[]).find(x=>String(x.columnId)===String(c.columnId));
        if(!cell)return;
        const label=String(cell.value??'');if(!label.trim())return;
        counts.set(label,(counts.get(label)||0)+1);
        if(!map[label])map[label]='V'+String(++max).padStart(3,'0');
        cell.valueId=map[label];
      });
      registry[tableKey][colKey]=map;
      c.valueCatalog=[...counts.entries()].map(([label,count])=>({valueId:String(map[label]),label,count}));
    });
    try{storage?.setItem('table.valueCatalog.v1',JSON.stringify(registry))}catch(e){}
    return this.table;
  }
}
g.ColumnManager=ColumnManager;
})(window);
