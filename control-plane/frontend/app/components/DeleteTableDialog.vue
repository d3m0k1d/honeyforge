<script setup lang="ts">
const store = useTablesStore();

const open = computed({
  get: () => store.pendingDeleteId !== null,
  set: (value) => {
    if (!value) store.cancelDelete();
  },
});
</script>

<template>
  <UModal
    v-model:open="open"
    title="Удалить таблицу?"
    description="Это действие необратимо"
  >
    <template #body>
      <p class="text-sm text-toned">
        Таблица
        <span class="font-mono font-semibold text-highlighted">
          {{ store.deletingTable?.name }}
        </span>
        и все её данные будут удалены без возможности восстановления.
      </p>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Отмена"
          @click="store.cancelDelete()"
        />
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          label="Удалить"
          @click="store.confirmDelete()"
        />
      </div>
    </template>
  </UModal>
</template>
