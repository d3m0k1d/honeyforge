<script setup lang="ts">
definePageMeta({ layout: "admin", middleware: "admin" });

const auth = useAuthStore();
const admin = useAdminStore();

const tabs = [
  {
    label: "Пользователи",
    value: "users",
    icon: "i-lucide-users-round",
    slot: "users",
  },
  {
    label: "Роли и разрешения",
    value: "roles",
    icon: "i-lucide-shield-check",
    slot: "roles",
  },
];

const tabsUi = {
  list: "w-full bg-muted/40 border border-default rounded-lg p-0.5",
  trigger: "flex-1 justify-center gap-1.5 text-xs uppercase tracking-[0.14em]",
  content: "p-4 sm:p-5",
};

const tab = ref("users");

onMounted(() => {
  auth.loadUsers();
  admin.loadRoles();
});
</script>

<template>
  <div class="flex h-full flex-col gap-5">
    <div class="border-b border-default pb-3">
      <h1 class="text-lg font-semibold tracking-tight text-highlighted">
        Админ-панель
      </h1>
      <p class="text-eyebrow mt-1">
        {{ admin.activeService.label }} · {{ admin.activeService.description }}
      </p>
    </div>

    <div
      v-if="admin.activeService.ready"
      class="rounded-lg border border-default bg-default/95 shadow-sm"
    >
      <UTabs v-model="tab" :items="tabs" :ui="tabsUi">
        <template #users>
          <AdminUsersPanel />
        </template>
        <template #roles>
          <AdminRolesPanel />
        </template>
      </UTabs>
    </div>

    <UCard v-else>
      <div class="flex flex-col items-center gap-3 py-10 text-center">
        <div
          class="flex size-12 items-center justify-center rounded-lg border border-default bg-elevated"
        >
          <UIcon :name="admin.activeService.icon" class="size-6 text-primary" />
        </div>
        <div>
          <p class="text-sm font-semibold text-highlighted">
            {{ admin.activeService.label }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ admin.activeService.description }}
          </p>
        </div>
        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
          label="В разработке"
        />
      </div>
    </UCard>
  </div>
</template>
