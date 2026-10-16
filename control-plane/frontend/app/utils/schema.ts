import type { CellValue, Column, ColumnReference, ColumnType, TableRow, TableSchema } from "~/types/database";
import type { DatabaseTableDef, DatabaseWorkspaceRead } from "~/types/api";

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

/** Имя таблицы/поля: тот же regex, что требует backend (SQL identifier). */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidIdentifier(value: string) {
  return IDENTIFIER_PATTERN.test(value.trim());
}

function normalizeType(value: unknown): ColumnType {
  const type = String(value ?? "TEXT").toUpperCase();

  return (COLUMN_TYPES as string[]).includes(type)
    ? (type as ColumnType)
    : "TEXT";
}

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value;

  return String(value);
}

function normalizeReferences(value: unknown): ColumnReference | undefined {
  if (!value || typeof value !== "object") return undefined;

  const ref = value as Record<string, unknown>;

  if (typeof ref.tableId !== "string" || typeof ref.columnId !== "string") {
    return undefined;
  }

  return { tableId: ref.tableId, columnId: ref.columnId };
}

/** Workspace API → модель конструктора (таблицы + строки по id колонок). */
export function parseWorkspace(workspace: DatabaseWorkspaceRead): {
  tables: TableSchema[];
  rows: Record<string, TableRow[]>;
} {
  const tables: TableSchema[] = [];
  const rows: Record<string, TableRow[]> = {};

  workspace.tables.forEach((def: DatabaseTableDef, index) => {
    const meta = def.meta ?? {};
    const columns: Column[] = (def.columns ?? []).map((raw, colIndex) => {
      const column = raw as Record<string, unknown>;

      return {
        id:
          typeof column.id === "string" && column.id
            ? column.id
            : createId("col"),
        name: String(column.name ?? `col_${colIndex + 1}`),
        type: normalizeType(column.type),
        length:
          typeof column.length === "number" ? column.length : undefined,
        primaryKey: Boolean(column.primaryKey),
        nullable: column.nullable !== false,
        unique: Boolean(column.unique),
        default:
          typeof column.default === "string" && column.default
            ? column.default
            : undefined,
        references: normalizeReferences(column.references),
      };
    });

    const id =
      typeof meta.id === "string" && meta.id ? meta.id : createId("tbl");

    tables.push({
      id,
      name: def.name,
      color:
        typeof meta.color === "string" && meta.color
          ? meta.color
          : TABLE_COLORS[index % TABLE_COLORS.length]!,
      x: typeof meta.x === "number" ? meta.x : 80 + (index % 4) * 340,
      y: typeof meta.y === "number" ? meta.y : 80 + (index % 3) * 60,
      columns,
    });

    rows[id] = (def.rows ?? []).map((rawRow) => {
      const raw = rawRow as Record<string, unknown>;
      const row: TableRow = {};

      for (const column of columns) {
        row[column.id] = normalizeCell(raw[column.name]);
      }

      return row;
    });
  });

  return { tables, rows };
}

/** Модель конструктора → payload /databases (строки ключируются по имени). */
export function serializeWorkspace(
  tables: TableSchema[],
  rows: Record<string, TableRow[]>,
): DatabaseTableDef[] {
  return tables.map((table) => ({
    name: table.name,
    columns: table.columns.map((column) => ({
      id: column.id,
      name: column.name,
      type: column.type,
      ...(column.length ? { length: column.length } : {}),
      primaryKey: column.primaryKey,
      nullable: column.nullable,
      unique: column.unique,
      ...(column.default ? { default: column.default } : {}),
      ...(column.references ? { references: { ...column.references } } : {}),
    })),
    rows: (rows[table.id] ?? []).map((row) => {
      const out: Record<string, string | number | boolean | null> = {};

      for (const column of table.columns) {
        out[column.name] = (row[column.id] ?? null) as
          | string
          | number
          | boolean
          | null;
      }

      return out;
    }),
    meta: {
      id: table.id,
      color: table.color,
      x: table.x,
      y: table.y,
    },
  }));
}
