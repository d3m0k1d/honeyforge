<script setup lang="ts">
const auth = useAuthStore();
const router = useRouter();

const dropdownUi = {
  content: "w-52",
  item: "cursor-pointer",
  itemLeadingIcon: "text-muted",
};

const items = computed(() => {
  const main = [
    { label: "Профиль", icon: "i-lucide-user-round", to: "/profile" },
    { label: "Настройки", icon: "i-lucide-settings", to: "/settings" },
  ];

  if (auth.user?.isAdmin) {
    main.splice(1, 0, {
      label: "Админ-панель",
      icon: "i-lucide-shield-alert",
      to: "/admin",
    });
  }

  return [
    main,
    [
      {
        label: "Выйти",
        icon: "i-lucide-log-out",
        color: "error",
        onSelect: onLogout,
      },
    ],
  ];
});

function onLogout() {
  auth.logout();
  router.push("/");
}
</script>

<template>
  <UDropdownMenu
    v-if="auth.isAuthenticated"
    :items="items"
    :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
    :ui="dropdownUi"
  >
    <UButton
      class="cursor-pointer"
      color="neutral"
      variant="solid"
      size="sm"
      icon="i-lucide-user-round"
      :label="auth.user?.login"
      trailing-icon="i-lucide-chevron-down"
    />
  </UDropdownMenu>
</template>
