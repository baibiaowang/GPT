export class RowManager {
  constructor(rows = []) {
    this.rows = rows;
  }

  getRow(rowId) {
    return this.rows.find(row => row.rowId === rowId) || null;
  }

  filter(columnId, value) {
    return this.rows.filter(row => {
      const cell = row.cells.find(c => c.columnId === columnId);
      return cell && cell.value === value;
    });
  }
}
