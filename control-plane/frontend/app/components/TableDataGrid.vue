<script setup lang="ts">
import type { Column, TableRow } from "~/types/database";

const store = useTablesStore();

const table = computed(() => store.selectedTable);

const numericTypes = ["INTEGER", "BIGINT", "SERIAL", "DECIMAL"];

function rowsFor(tableId: string): TableRow[] {
  return store.rows[tableId] ?? [];
}

function isNumber(column: Column) {
  return numericTypes.includes(column.type);
}

function cellValue(row: TableRow, column: Column) {
  const value = row[column.id];

  return value === null || value === undefined ? "" : String(value);
}
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div
      v-if="!table"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <UIcon name="i-lucide-table" class="size-10 text-dimmed" />
      <div>
        <p class="text-sm font-medium text-toned">Таблица не выбрана</p>
        <p class="text-xs text-muted">
          Выберите таблицу в сайдбаре, чтобы просмотреть данные
        </p>
      </div>
    </div>

    <template v-else>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span
            class="size-2.5 rounded-full"
            :style="{ background: table.color }"
          />
          <h2 class="font-mono text-sm font-semibold text-highlighted">
            {{ table.name }}
          </h2>
          <UBadge color="neutral" variant="outline" size="sm">
            {{ rowsFor(table.id).length }} строк
          </UBadge>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="Добавить строку"
          size="sm"
          color="primary"
          @click="store.addRow(table.id)"
        />
      </div>

      <div
        class="overflow-auto rounded-lg border border-default bg-default"
      >
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="bg-elevated/60 text-left">
              <th class="w-10 px-3 py-2 text-xs font-medium text-muted">#</th>
              <th
                v-for="column in table.columns"
                :key="column.id"
                class="px-3 py-2"
              >
                <div class="flex items-center gap-1.5">
                  <UIcon
                    :name="columnIcon(column)"
                    class="size-3.5 text-dimmed"
                  />
                  <span class="font-mono text-xs text-highlighted">
                    {{ column.name }}
                  </span>
                  <span class="font-mono text-[10px] text-dimmed">
                    {{ formatColumnType(column) }}
                  </span>
                </div>
              </th>
              <th class="w-10" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in rowsFor(table.id)"
              :key="rowIndex"
              class="border-t border-default"
            >
              <td class="px-3 py-1.5 font-mono text-xs text-dimmed">
                {{ rowIndex + 1 }}
              </td>
              <td
                v-for="column in table.columns"
                :key="column.id"
                class="px-2 py-1"
              >
                <USwitch
                  v-if="column.type === 'BOOLEAN'"
                  :model-value="Boolean(row[column.id])"
                  size="sm"
                  @update:model-value="
                    store.updateCell(table.id, rowIndex, column.id, $event)
                  "
                />
                <UInput
                  v-else
                  :model-value="cellValue(row, column)"
                  :type="isNumber(column) ? 'number' : 'text'"
                  size="xs"
                  variant="none"
                  class="w-full font-mono"
                  @update:model-value="
                    store.updateCell(
                      table.id,
                      rowIndex,
                      column.id,
                      isNumber(column) ? Number($event) : $event,
                    )
                  "
                />
              </td>
              <td class="px-1">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  aria-label="Удалить строку"
                  @click="store.deleteRow(table.id, rowIndex)"
                />
              </td>
            </tr>
            <tr v-if="!rowsFor(table.id).length">
              <td
                :colspan="table.columns.length + 2"
                class="px-3 py-10 text-center text-xs text-muted"
              >
                Данных нет — добавьте первую строку
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
