import { defineStore } from "pinia";
import type {
  Column,
  ColumnType,
  TableRow,
  TableSchema,
  TabKey,
} from "~/types/database";
import {
  TABLE_COLORS,
  createId,
  emptyColumn,
} from "~/utils/schema";

function seedTables(): TableSchema[] {
  return [
    {
      id: "tbl_users",
      name: "users",
      color: TABLE_COLORS[0],
      x: 60,
      y: 80,
      columns: [
        {
          id: "col_users_id",
          name: "id",
          type: "SERIAL",
          primaryKey: true,
          nullable: false,
          unique: true,
        },
        {
          id: "col_users_email",
          name: "email",
          type: "VARCHAR",
          length: 255,
          primaryKey: false,
          nullable: false,
          unique: true,
        },
        {
          id: "col_users_name",
          name: "name",
          type: "VARCHAR",
          length: 120,
          primaryKey: false,
          nullable: true,
          unique: false,
        },
        {
          id: "col_users_created",
          name: "created_at",
          type: "TIMESTAMP",
          primaryKey: false,
          nullable: false,
          unique: false,
          default: "now()",
        },
      ],
    },
    {
      id: "tbl_sessions",
      name: "sessions",
      color: TABLE_COLORS[1],
      x: 420,
      y: 150,
      columns: [
        {
          id: "col_sessions_id",
          name: "id",
          type: "UUID",
          primaryKey: true,
          nullable: false,
          unique: true,
        },
        {
          id: "col_sessions_user",
          name: "user_id",
          type: "INTEGER",
          primaryKey: false,
          nullable: false,
          unique: false,
          references: { tableId: "tbl_users", columnId: "col_users_id" },
        },
        {
          id: "col_sessions_ip",
          name: "ip",
          type: "VARCHAR",
          length: 45,
          primaryKey: false,
          nullable: true,
          unique: false,
        },
        {
          id: "col_sessions_started",
          name: "started_at",
          type: "TIMESTAMP",
          primaryKey: false,
          nullable: false,
          unique: false,
          default: "now()",
        },
      ],
    },
    {
      id: "tbl_alerts",
      name: "alerts",
      color: TABLE_COLORS[4],
      x: 760,
      y: 90,
      columns: [
        {
          id: "col_alerts_id",
          name: "id",
          type: "SERIAL",
          primaryKey: true,
          nullable: false,
          unique: true,
        },
        {
          id: "col_alerts_session",
          name: "session_id",
          type: "UUID",
          primaryKey: false,
          nullable: false,
          unique: false,
          references: { tableId: "tbl_sessions", columnId: "col_sessions_id" },
        },
        {
          id: "col_alerts_severity",
          name: "severity",
          type: "VARCHAR",
          length: 20,
          primaryKey: false,
          nullable: false,
          unique: false,
          default: "'low'",
        },
        {
          id: "col_alerts_message",
          name: "message",
          type: "TEXT",
          primaryKey: false,
          nullable: true,
          unique: false,
        },
      ],
    },
  ];
}

function seedRows(): Record<string, TableRow[]> {
  return {
    tbl_users: [
      {
        col_users_id: 1,
        col_users_email: "root@honeypotforge.io",
        col_users_name: "root",
        col_users_created: "2026-01-04 09:12:00",
      },
      {
        col_users_id: 2,
        col_users_email: "analyst@honeypotforge.io",
        col_users_name: "analyst",
        col_users_created: "2026-01-05 18:40:00",
      },
    ],
    tbl_sessions: [
      {
        col_sessions_id: "3f1a...c2",
        col_sessions_user: 1,
        col_sessions_ip: "185.220.101.4",
        col_sessions_started: "2026-02-10 22:01:00",
      },
      {
        col_sessions_id: "8b22...91",
        col_sessions_user: 1,
        col_sessions_ip: "45.155.205.12",
        col_sessions_started: "2026-02-11 03:17:00",
      },
    ],
    tbl_alerts: [
      {
        col_alerts_id: 1,
        col_alerts_session: "3f1a...c2",
        col_alerts_severity: "high",
        col_alerts_message: "SSH bruteforce detected",
      },
    ],
  };
}

export const useTablesStore = defineStore("tables", () => {
  const tables = ref<TableSchema[]>(seedTables());
  const rows = ref<Record<string, TableRow[]>>(seedRows());
  const selectedTableId = ref<string | null>(tables.value[0]?.id ?? null);
  const activeTab = ref<TabKey>("constructor");
  const search = ref("");

  const tableModal = reactive<{ open: boolean; tableId: string | null }>({
    open: false,
    tableId: null,
  });
  const pendingDeleteId = ref<string | null>(null);

  const filteredTables = computed(() => {
    const query = search.value.trim().toLowerCase();

    if (!query) return tables.value;

    return tables.value.filter((table) =>
      table.name.toLowerCase().includes(query),
    );
  });

  const selectedTable = computed(
    () => tables.value.find((table) => table.id === selectedTableId.value) ?? null,
  );

  const relations = computed(() => {
    const list: {
      id: string;
      fromTableId: string;
      fromColumnId: string;
      toTableId: string;
      toColumnId: string;
      color: string;
    }[] = [];

    for (const table of tables.value) {
      for (const column of table.columns) {
        if (column.references) {
          list.push({
            id: `${table.id}:${column.id}`,
            fromTableId: table.id,
            fromColumnId: column.id,
            toTableId: column.references.tableId,
            toColumnId: column.references.columnId,
            color: table.color,
          });
        }
      }
    }

    return list;
  });

  const deletingTable = computed(
    () => tables.value.find((table) => table.id === pendingDeleteId.value) ?? null,
  );

  function getTable(id: string | null) {
    if (!id) return null;
    return tables.value.find((table) => table.id === id) ?? null;
  }

  function selectTable(id: string) {
    selectedTableId.value = id;
  }

  function openTable(id: string) {
    selectedTableId.value = id;
    activeTab.value = "data";
  }

  function setActiveTab(tab: TabKey) {
    activeTab.value = tab;
  }

  function createTable(name: string, columns: Column[]) {
    const table: TableSchema = {
      id: createId("tbl"),
      name: name.trim() || "untitled",
      color: TABLE_COLORS[tables.value.length % TABLE_COLORS.length]!,
      columns: columns.length ? columns : [emptyColumn()],
      x: 80 + (tables.value.length % 4) * 60,
      y: 80 + (tables.value.length % 4) * 50,
    };

    tables.value.push(table);
    rows.value[table.id] = [];
    selectedTableId.value = table.id;
    return table;
  }

  function renameTable(id: string, name: string) {
    const table = getTable(id);
    const next = name.trim();

    if (table && next) table.name = next;
  }

  function deleteTable(id: string) {
    const index = tables.value.findIndex((table) => table.id === id);

    if (index < 0) return;

    tables.value.splice(index, 1);
    delete rows.value[id];

    for (const table of tables.value) {
      for (const column of table.columns) {
        if (column.references && column.references.tableId === id) {
          column.references = undefined;
        }
      }
    }

    if (selectedTableId.value === id) {
      selectedTableId.value = tables.value[0]?.id ?? null;
    }
  }

  function moveTable(id: string, x: number, y: number) {
    const table = getTable(id);

    if (!table) return;

    table.x = Math.max(0, Math.round(x));
    table.y = Math.max(0, Math.round(y));
  }

  function updateTable(id: string, name: string, columns: Column[]) {
    const table = getTable(id);

    if (!table) return;

    table.name = name.trim() || table.name;
    table.columns = columns;

    for (const column of table.columns) {
      if (column.references && column.references.tableId === id) {
        column.references = undefined;
      }
    }
  }

  function addColumn(tableId: string, type: ColumnType = "VARCHAR") {
    const table = getTable(tableId);

    if (!table) return;

    table.columns.push({ ...emptyColumn(), type });
  }

  function removeColumn(tableId: string, columnId: string) {
    const table = getTable(tableId);

    if (!table) return;

    const index = table.columns.findIndex((column) => column.id === columnId);

    if (index >= 0) table.columns.splice(index, 1);
  }

  function addRow(tableId: string) {
    const table = getTable(tableId);

    if (!table) return;

    if (!rows.value[tableId]) rows.value[tableId] = [];

    const row: TableRow = {};

    for (const column of table.columns) {
      row[column.id] = column.default ?? null;
    }

    rows.value[tableId]!.push(row);
  }

  function updateCell(
    tableId: string,
    rowIndex: number,
    columnId: string,
    value: TableRow[string],
  ) {
    const list = rows.value[tableId];

    if (!list || !list[rowIndex]) return;

    list[rowIndex]![columnId] = value;
  }

  function deleteRow(tableId: string, rowIndex: number) {
    const list = rows.value[tableId];

    if (!list) return;

    list.splice(rowIndex, 1);
  }

  function openCreateModal() {
    tableModal.tableId = null;
    tableModal.open = true;
  }

  function openEditModal(id: string) {
    tableModal.tableId = id;
    tableModal.open = true;
  }

  function closeTableModal() {
    tableModal.open = false;
    tableModal.tableId = null;
  }

  function requestDelete(id: string) {
    pendingDeleteId.value = id;
  }

  function cancelDelete() {
    pendingDeleteId.value = null;
  }

  function confirmDelete() {
    if (pendingDeleteId.value) deleteTable(pendingDeleteId.value);
    pendingDeleteId.value = null;
  }

  return {
    tables,
    rows,
    selectedTableId,
    selectedTable,
    activeTab,
    search,
    filteredTables,
    relations,
    tableModal,
    pendingDeleteId,
    deletingTable,
    getTable,
    selectTable,
    openTable,
    setActiveTab,
    createTable,
    renameTable,
    deleteTable,
    moveTable,
    updateTable,
    addColumn,
    removeColumn,
    addRow,
    updateCell,
    deleteRow,
    openCreateModal,
    openEditModal,
    closeTableModal,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
});
