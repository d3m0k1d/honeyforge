export type ColumnType =
  | "SERIAL"
  | "INTEGER"
  | "BIGINT"
  | "DECIMAL"
  | "VARCHAR"
  | "TEXT"
  | "BOOLEAN"
  | "DATE"
  | "TIMESTAMP"
  | "UUID"
  | "JSON";

export interface ColumnReference {
  tableId: string;
  columnId: string;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  length?: number;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
  default?: string;
  references?: ColumnReference;
}

export interface TableSchema {
  id: string;
  name: string;
  color: string;
  columns: Column[];
  x: number;
  y: number;
}

export type CellValue = string | number | boolean | null;

export type TableRow = Record<string, CellValue>;

export type TabKey = "constructor" | "data" | "editor";
