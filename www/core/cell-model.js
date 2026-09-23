export class CellModel {
  constructor({ columnId, value }) {
    this.columnId = columnId;
    this.value = value;
  }
}

export function createCell(columnId, value) {
  return new CellModel({ columnId, value });
}
