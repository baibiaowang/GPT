export class ColumnManager {
  constructor(columns = []) {
    this.columns = columns;
  }

  getColumn(columnId) {
    return this.columns.find(c => c.columnId === columnId) || null;
  }

  uniqueValues(rows, columnId) {
    return [...new Set(rows.map(r => {
      const cell = r.cells.find(c => c.columnId === columnId);
      return cell ? cell.value : null;
    }).filter(v => v !== null && v !== ''))];
  }
}
