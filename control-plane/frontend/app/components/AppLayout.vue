<script setup lang="ts">
import type { RadialMenuItem } from "~/components/RadialMenu.vue";

const auth = useAuthStore();
const route = useRoute();
const settings = useSettingsStore();
const analytics = useAnalyticsStore();

const sidebarOpen = defineModel<boolean>("sidebar", { default: false });

interface MenuItem extends RadialMenuItem {
  /** Permission из ролей API; скрывается у вошедшего без него. */
  permission?: string;
}

const BASE_MENU_ITEMS: MenuItem[] = [
  { label: "Дашборд", to: "/", icon: "i-lucide-layout-dashboard" },
  { label: "Ловушки", to: "/traps", icon: "i-lucide-radar", permission: "honeypots:read" },
  { label: "Профили", to: "/traps/profiles", icon: "i-lucide-blocks", permission: "profiles:read" },
  { label: "Аналитика", to: "/analytics", icon: "i-lucide-chart-line", permission: "analytics:read" },
  { label: "Инциденты", to: "/incidents", icon: "i-lucide-shield-alert", permission: "alerts:read" },
  { label: "Сенсоры", to: "/sensors", icon: "i-lucide-server-cog", permission: "agents:read" },
  { label: "Конструктор", to: "/tables", icon: "i-lucide-database", permission: "databases:read" },
  { label: "Журналы", to: "/logs", icon: "i-lucide-terminal", permission: "audit:read" },
  { label: "Настройки", to: "/settings", icon: "i-lucide-settings" },
];

const menuItems = computed<MenuItem[]>(() =>
  BASE_MENU_ITEMS.filter(
    (item) =>
      !item.permission ||
      !auth.isAuthenticated ||
      auth.can(item.permission),
  ),
);

const radialEnabled = computed(() => settings.navMode === "radial");

const menuHint = computed(() =>
  route.path === "/" && auth.isAuthenticated && radialEnabled.value
    ? "Нажмите ЛКМ по любой точке для навигации по сервису"
    : "",
);

function isNavActive(to: string) {
  if (to === "/") return route.path === "/";

  return route.path.startsWith(to);
}

onMounted(() => {
  settings.load();

  if (analytics.period !== settings.defaultPeriod) {
    analytics.setPeriod(settings.defaultPeriod);
  }
});
</script>

<template>
  <div class="flex min-h-screen flex-col bg-default text-default">
    <header
      class="sticky top-0 z-40 border-b border-default bg-default/80 backdrop-blur-md"
    >
      <div class="flex h-18 items-center gap-4 px-4 sm:px-6">
        <div class="flex items-center gap-3">
          <AppLogo />
          <p class="hidden text-eyebrow sm:block">
            • Платформа модерации honeypot-инцидентов
          </p>
        </div>

        <UDropdownMenu
          v-if="!radialEnabled"
          class="lg:hidden"
          :items="menuItems"
          :content="{ align: 'start' }"
          data-radial-ignore
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-menu"
            aria-label="Открыть меню"
            class="cursor-pointer"
          />
        </UDropdownMenu>

        <nav
          v-if="!radialEnabled"
          class="ml-2 hidden items-center gap-0.5 lg:flex"
          data-radial-ignore
        >
          <NuxtLink
            v-for="item in menuItems"
            :key="item.to"
            :to="item.to"
            class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
            :class="
              isNavActive(item.to)
                ? 'bg-elevated text-highlighted'
                : 'text-muted hover:bg-elevated/60 hover:text-highlighted'
            "
          >
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="ml-auto flex items-center gap-1.5">
          <UserMenu v-if="auth.isAuthenticated" />
          <UButton
            v-else
            class="cursor-pointer"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-log-in"
            label="Войти"
            to="/login"
          />
          <UColorModeButton color="neutral" variant="ghost" size="sm" />
        </div>
      </div>
    </header>

    <div class="flex flex-1">
      <aside
        v-if="sidebarOpen"
        class="w-64 shrink-0 border-r border-default bg-muted/30"
      >
        <div class="p-4">
          <slot name="sidebar" />
        </div>
      </aside>

      <main class="min-w-0 flex-1 p-4 sm:p-6">
        <slot />
      </main>
    </div>

    <footer class="border-t border-default bg-default/90">
      <div
        class="flex flex-col gap-1.5 px-4 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6"
      >
        <p class="uppercase tracking-[0.12em]">© 2026 HoneypotForge</p>
        <p class="font-mono tracking-[0.3em] text-dimmed">v0.1.0</p>
      </div>
    </footer>

    <RadialMenu
      :items="menuItems"
      :enabled="radialEnabled"
      :radius="settings.radialRadius"
    />
  </div>
</template>
