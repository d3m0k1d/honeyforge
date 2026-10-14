<script setup lang="ts">
const admin = useAdminStore();

function isActive(id: string) {
  return admin.activeServiceId === id;
}
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-shield-alert" class="size-4 text-dimmed" />
      <h2 class="text-eyebrow">
        Админ-панель
      </h2>
    </div>

    <div class="flex-1 space-y-1 overflow-y-auto">
      <div
        v-for="service in admin.services"
        :key="service.id"
        class="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-all"
        :class="
          isActive(service.id)
            ? 'border-accented bg-elevated text-highlighted shadow-sm'
            : 'border-transparent text-toned hover:border-accented/60 hover:bg-elevated/40'
        "
        data-radial-ignore
        @click="admin.setService(service.id)"
      >
        <UIcon
          :name="service.icon"
          class="size-4 shrink-0"
          :class="isActive(service.id) ? 'text-primary' : 'text-dimmed'"
        />
        <span class="flex-1 truncate text-sm">{{ service.label }}</span>
        <UBadge
          v-if="!service.ready"
          color="neutral"
          variant="outline"
          size="sm"
          label="скоро"
        />
      </div>
    </div>
  </div>
</template>
