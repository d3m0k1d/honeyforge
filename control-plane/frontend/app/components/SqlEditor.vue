<script setup lang="ts">
const store = useTablesStore();

const sql = ref("SELECT *\nFROM users\nORDER BY id;");

function run() {
  if (!sql.value.trim() || store.queryLoading) return;

  void store.runQuery(sql.value);
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "NULL";

  return String(value);
}
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-terminal" class="size-4 text-dimmed" />
        <span class="text-eyebrow font-mono">
          SQL Редактор
        </span>
        <UBadge color="neutral" variant="outline" size="sm">
          только чтение · SELECT / WITH / PRAGMA
        </UBadge>
      </div>
      <UButton
        icon="i-lucide-play"
        label="Выполнить"
        size="sm"
        color="primary"
        :loading="store.queryLoading"
        :disabled="!sql.trim() || store.queryLoading"
        @click="run"
      />
    </div>

    <UTextarea
      v-model="sql"
      :rows="12"
      class="w-full"
      :ui="{ base: 'font-mono text-sm' }"
      @keydown.ctrl.enter="run"
      @keydown.meta.enter="run"
    />

    <UAlert
      v-if="store.queryError"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      title="Ошибка запроса"
      :description="store.queryError"
    />

    <div
      v-if="store.queryResult"
      class="overflow-auto rounded-lg border border-default bg-default"
    >
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-elevated/60 text-left">
            <th
              v-for="column in store.queryResult.columns"
              :key="column"
              class="px-3 py-2 font-mono text-xs text-highlighted"
            >
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, rowIndex) in store.queryResult.rows"
            :key="rowIndex"
            class="border-t border-default"
          >
            <td
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
              class="px-3 py-1.5 font-mono text-xs text-toned"
              :class="cell === null || cell === undefined ? 'text-dimmed' : ''"
            >
              {{ formatCell(cell) }}
            </td>
          </tr>
          <tr v-if="!store.queryResult.rows.length">
            <td
              :colspan="Math.max(1, store.queryResult.columns.length)"
              class="px-3 py-8 text-center text-xs text-muted"
            >
              Запрос выполнен, строк нет
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-else-if="!store.queryError"
      class="rounded-lg border border-default bg-default p-3 font-mono text-xs text-dimmed"
    >
      -- результаты появятся здесь · Ctrl+Enter — выполнить
    </div>
  </div>
</template>
