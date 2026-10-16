<script setup lang="ts">
import type { Column } from "~/types/database";
import { isValidIdentifier } from "~/utils/schema";

const store = useTablesStore();

const open = computed({
  get: () => store.tableModal.open,
  set: (value) => {
    if (!value) store.closeTableModal();
  },
});

const name = ref("");
const columns = ref<Column[]>([]);

const isEdit = computed(() => Boolean(store.tableModal.tableId));

// backend принимает только SQL-идентификаторы (как в реальной схеме БД)
const nameInvalid = computed(
  () => Boolean(name.value.trim()) && !isValidIdentifier(name.value),
);

const invalidColumns = computed(() =>
  columns.value
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !isValidIdentifier(column.name)),
);

const hasErrors = computed(
  () => nameInvalid.value || invalidColumns.value.length > 0,
);

const tableRefOptions = computed(() => [
  { label: "Нет", value: "__none__" },
  ...store.tables
    .filter((table) => table.id !== store.tableModal.tableId)
    .map((table) => ({ label: table.name, value: table.id })),
]);

watch(
  () => store.tableModal.open,
  (isOpen) => {
    if (!isOpen) return;

    const table = store.tableModal.tableId
      ? store.getTable(store.tableModal.tableId)
      : null;

    if (table) {
      name.value = table.name;
      columns.value = table.columns.map((column) => ({
        ...column,
        references: column.references ? { ...column.references } : undefined,
      }));
    } else {
      name.value = "";
      columns.value = [emptyColumn()];
    }
  },
);

function columnRefOptions(tableId: string) {
  const table = store.getTable(tableId);

  return (table?.columns ?? []).map((column) => ({
    label: column.name || column.id,
    value: column.id,
  }));
}

function onReferenceTable(index: number, tableId: string) {
  const column = columns.value[index];

  if (!column) return;

  if (!tableId || tableId === "__none__") {
    column.references = undefined;
    return;
  }

  const table = store.getTable(tableId);
  column.references = { tableId, columnId: table?.columns[0]?.id ?? "" };
}

function addColumn() {
  columns.value.push(emptyColumn());
}

function removeColumn(index: number) {
  columns.value.splice(index, 1);
}

function save() {
  const tableName = name.value.trim();
  const prepared = columns.value.filter((column) => column.name.trim());
  const result = prepared.length ? prepared : columns.value;

  if (!tableName || hasErrors.value) return;

  if (store.tableModal.tableId) {
    store.updateTable(store.tableModal.tableId, tableName, result);
  } else {
    store.createTable(tableName, result);
  }

  store.closeTableModal();
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? 'Изменить таблицу' : 'Новая таблица'"
    description="Опишите поля и типы данных как в настоящей схеме БД"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <div class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <UFormField label="Название таблицы" required>
          <UInput
            v-model="name"
            placeholder="например, honeypot_events"
            class="w-full font-mono"
            :color="nameInvalid ? 'error' : undefined"
          />
          <template #help>
            <span v-if="nameInvalid" class="text-error text-xs">
              Латиница, цифры и _, без пробелов (как в SQL)
            </span>
          </template>
        </UFormField>

        <div class="flex items-center justify-between">
          <span class="text-eyebrow">
            Поля
          </span>
          <UButton
            icon="i-lucide-plus"
            label="Добавить поле"
            color="neutral"
            variant="soft"
            size="xs"
            @click="addColumn"
          />
        </div>

        <div class="space-y-3">
          <div
            v-for="(column, index) in columns"
            :key="column.id"
            class="space-y-3 rounded-lg border border-default bg-elevated/40 p-3"
          >
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-table-2" class="text-muted" />
              <UInput
                v-model="column.name"
                placeholder="имя_поля"
                size="sm"
                class="flex-1 font-mono"
                :color="!isValidIdentifier(column.name) && column.name.trim() ? 'error' : undefined"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                :disabled="columns.length === 1"
                @click="removeColumn(index)"
              />
            </div>

            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <UFormField label="Тип">
                <USelect
                  v-model="column.type"
                  :items="COLUMN_TYPES"
                  size="sm"
                  class="w-full"
                />
              </UFormField>

              <UFormField v-if="TYPES_WITH_LENGTH.includes(column.type)" label="Длина">
                <UInput
                  v-model.number="column.length"
                  type="number"
                  size="sm"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="По умолчанию">
                <UInput
                  v-model="column.default"
                  placeholder="—"
                  size="sm"
                  class="w-full font-mono"
                />
              </UFormField>

              <UFormField label="Ссылка на таблицу">
                <USelect
                  :model-value="column.references?.tableId ?? '__none__'"
                  :items="tableRefOptions"
                  size="sm"
                  class="w-full"
                  @update:model-value="onReferenceTable(index, $event as string)"
                />
              </UFormField>

              <UFormField
                v-if="column.references"
                label="Ссылка на поле"
              >
                <USelect
                  v-model="column.references.columnId"
                  :items="columnRefOptions(column.references.tableId)"
                  size="sm"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
              <UCheckbox v-model="column.primaryKey" label="PRIMARY KEY" />
              <UCheckbox
                :model-value="!column.nullable"
                label="NOT NULL"
                @update:model-value="column.nullable = !$event"
              />
              <UCheckbox v-model="column.unique" label="UNIQUE" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Отмена"
          @click="store.closeTableModal()"
        />
        <UButton
          icon="i-lucide-check"
          :label="isEdit ? 'Сохранить' : 'Создать'"
          :disabled="!name.trim() || hasErrors"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
