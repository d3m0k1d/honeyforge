<script setup lang="ts">
import type { TableSchema } from "~/types/database";

const store = useTablesStore();

const editingId = ref<string | null>(null);
const editName = ref("");

function startRename(table: TableSchema) {
  editingId.value = table.id;
  editName.value = table.name;
}

function saveRename() {
  if (editingId.value) store.renameTable(editingId.value, editName.value);
  editingId.value = null;
}

function cancelRename() {
  editingId.value = null;
}
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-database" class="size-4 text-dimmed" />
        <h2 class="text-eyebrow">
          База данных
        </h2>
      </div>
      <UBadge color="neutral" variant="outline" size="sm">
        {{ store.tables.length }} · {{ store.filteredTables.length }}
      </UBadge>
    </div>

    <UButton
      block
      icon="i-lucide-plus"
      label="Создать таблицу"
      size="sm"
      color="primary"
      @click="store.openCreateModal()"
    />

    <UInput
      v-model="store.search"
      icon="i-lucide-search"
      placeholder="Поиск по названию"
      size="sm"
      class="w-full"
    />

    <div class="flex-1 space-y-1 overflow-y-auto">
      <template v-for="table in store.filteredTables" :key="table.id">
        <div
          v-if="editingId === table.id"
          class="flex items-center gap-1 rounded-md border border-accented bg-elevated p-1"
        >
          <UInput
            v-model="editName"
            size="xs"
            class="flex-1"
            autofocus
            @keydown.enter="saveRename"
            @keydown.esc="cancelRename"
          />
          <UButton
            icon="i-lucide-check"
            color="primary"
            variant="ghost"
            size="xs"
            @click="saveRename"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="cancelRename"
          />
        </div>

        <div
          v-else
          class="group flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-all"
          :class="
            store.selectedTableId === table.id
              ? 'border-accented bg-elevated text-highlighted shadow-sm'
              : 'border-transparent text-toned hover:border-accented/60 hover:bg-elevated/40'
          "
          data-radial-ignore
          @click="store.openTable(table.id)"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            :style="{ background: table.color }"
          />
          <span class="flex-1 truncate text-sm">{{ table.name }}</span>
          <span class="font-mono text-[10px] text-dimmed">
            {{ table.columns.length }}
          </span>
          <div
            class="flex items-center opacity-0 transition-opacity group-hover:opacity-100"
          >
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Переименовать"
              @click.stop="startRename(table)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              aria-label="Удалить"
              @click.stop="store.requestDelete(table.id)"
            />
          </div>
        </div>
      </template>

      <UEmpty
        v-if="!store.filteredTables.length"
        icon="i-lucide-search"
        :title="store.tables.length ? 'Ничего не найдено' : 'Таблиц пока нет'"
        :description="
          store.tables.length
            ? 'Попробуйте изменить запрос'
            : 'Создайте первую таблицу'
        "
        variant="naked"
        class="py-8"
      />
    </div>
  </div>
</template>
