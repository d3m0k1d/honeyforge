<script setup lang="ts">
const sql = ref(
  "SELECT *\nFROM users\nWHERE created_at > now() - interval '7 days'\nORDER BY created_at DESC;",
);
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-terminal" class="size-4 text-dimmed" />
        <span class="text-eyebrow font-mono">
          SQL Редактор
        </span>
      </div>
      <UButton icon="i-lucide-play" label="Выполнить" size="sm" color="primary" />
    </div>

    <UTextarea
      v-model="sql"
      :rows="18"
      class="w-full"
      :ui="{ base: 'font-mono text-sm' }"
    />

    <div
      class="rounded-lg border border-default bg-default p-3 font-mono text-xs text-dimmed"
    >
      -- выполнение запросов пока не реализовано
    </div>
  </div>
</template>
