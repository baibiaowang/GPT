export class LocalAnnotation {
  constructor(storage = localStorage) {
    this.storage = storage;
    this.key = 'table_annotations';
  }

  load() {
    return JSON.parse(this.storage.getItem(this.key) || '[]');
  }

  save(item) {
    const list = this.load();
    list.push(item);
    this.storage.setItem(this.key, JSON.stringify(list));
  }

  find(tableId, rowId) {
    return this.load().filter(x => x.tableId === tableId && x.rowId === rowId);
  }
}
