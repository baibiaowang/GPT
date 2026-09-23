export class TableModel {
  constructor({ tableId, tableName, columns = [], rows = [] }) {
    this.tableId = tableId;
    this.tableName = tableName;
    this.columns = columns;
    this.rows = rows;
  }

  getVisibleColumns() {
    return this.columns.filter(c => c.visible !== false);
  }

  getRow(rowId) {
    return this.rows.find(r => r.rowId === rowId) || null;
  }
}
