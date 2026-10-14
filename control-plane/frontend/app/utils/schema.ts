import type { Column, ColumnType, TableSchema } from "~/types/database";

export const NODE_WIDTH = 240;
export const NODE_HEADER_HEIGHT = 44;
export const ROW_HEIGHT = 30;

export const COLUMN_TYPES: ColumnType[] = [
  "SERIAL",
  "INTEGER",
  "BIGINT",
  "DECIMAL",
  "VARCHAR",
  "TEXT",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
  "UUID",
  "JSON",
];

export const TYPES_WITH_LENGTH: ColumnType[] = ["VARCHAR", "DECIMAL"];

export const TABLE_COLORS = [
  "#10b981",
  "#38bdf8",
  "#a78bfa",
  "#f59e0b",
  "#f43f5e",
  "#2dd4bf",
];

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatColumnType(column: Column) {
  if (column.length && TYPES_WITH_LENGTH.includes(column.type)) {
    return `${column.type}(${column.length})`;
  }

  return column.type;
}

export function columnIcon(column: Column) {
  if (column.primaryKey) return "i-lucide-key-round";
  if (column.references) return "i-lucide-link-2";
  if (column.unique) return "i-lucide-fingerprint";

  switch (column.type) {
    case "INTEGER":
    case "BIGINT":
    case "SERIAL":
    case "DECIMAL":
      return "i-lucide-hash";
    case "BOOLEAN":
      return "i-lucide-toggle-left";
    case "DATE":
    case "TIMESTAMP":
      return "i-lucide-calendar";
    case "JSON":
      return "i-lucide-braces";
    default:
      return "i-lucide-circle-dot";
  }
}

export function nodeHeight(table: TableSchema) {
  return NODE_HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + 8;
}

export function columnAnchorY(table: TableSchema, columnId: string) {
  const index = table.columns.findIndex((c) => c.id === columnId);

  if (index < 0) return table.y + NODE_HEADER_HEIGHT / 2;

  return table.y + NODE_HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function emptyColumn(): Column {
  return {
    id: createId("col"),
    name: "",
    type: "VARCHAR",
    primaryKey: false,
    nullable: true,
    unique: false,
  };
}
