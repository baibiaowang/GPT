export class FilterEngine {
  static byColumn(rows, columnId, value) {
    return rows.filter(row => {
      const cell = row.cells.find(c => c.columnId === columnId);
      return cell?.value === value;
    });
  }

  static values(rows, columnId) {
    return [...new Set(rows.map(row => row.cells.find(c => c.columnId === columnId)?.value).filter(Boolean))];
  }
}
