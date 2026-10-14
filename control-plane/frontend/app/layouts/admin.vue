<script setup lang="ts">
const sidebarOpen = ref(true);
</script>

<template>
  <AppLayout v-model:sidebar="sidebarOpen">
    <template #sidebar>
      <div class="rounded-lg border border-default bg-default/95 shadow-sm">
        <div class="p-3">
          <AdminSidebar />
        </div>
      </div>
    </template>
    <slot />
  </AppLayout>
</template>
