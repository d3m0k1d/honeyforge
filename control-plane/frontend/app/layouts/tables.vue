<script setup lang="ts">
const sidebarOpen = ref(true);
const store = useTablesStore();

onMounted(() => {
  void store.load();
});
</script>

<template>
  <AppLayout v-model:sidebar="sidebarOpen">
    <template #sidebar>
      <div class="rounded-lg border border-default bg-default/95 shadow-sm">
        <div class="p-3">
          <TablesSidebar />
        </div>
      </div>
    </template>
    <slot />
    <TableFormModal />
    <DeleteTableDialog />
  </AppLayout>
</template>
