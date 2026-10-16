<script setup lang="ts">
import type { Trap, TrapFieldKey, TrapSort } from "~/types/traps";
import {
  AGENT_STATUSES,
  AGENT_STATUS_BY_KEY,
  LEVEL_BY_KEY,
  formatDate,
  formatEvents,
  profileIconFor,
  serviceMeta,
} from "~/utils/traps";

const store = useTrapsStore();
const router = useRouter();
const auth = useAuthStore();

const canManage = computed(() => auth.can("deployments:manage"));

const fields = computed(() => store.visibleFields);
const hasTraps = computed(() => store.filteredTraps.length > 0);
const showProfileColumn = computed(() => store.fieldVisibility.profile);

function show(key: TrapFieldKey) {
  return store.fieldVisibility[key];
}

function profileName(trap: Trap) {
  return store.profilesById[trap.profileId]?.name ?? "—";
}

function profileIcon(trap: Trap) {
  return (
    store.profileIconById[trap.profileId] ??
    profileIconFor(trap.services.map((service) => service.key))
  );
}

function visibleServices(trap: Trap) {
  return trap.services.filter(
    (service) => store.serviceVisibility[service.key] ?? true,
  );
}

function levelInfo(trap: Trap) {
  return LEVEL_BY_KEY[trap.level] ?? LEVEL_BY_KEY.low;
}

function statusInfo(trap: Trap) {
  return AGENT_STATUS_BY_KEY[trap.agentStatus] ?? AGENT_STATUS_BY_KEY.offline;
}

function sortIndicator(field: TrapFieldKey) {
  if (store.sort.field !== field) return "";

  return store.sort.direction === "asc"
    ? "i-lucide-chevron-up"
    : "i-lucide-chevron-down";
}

function toggleSort(field: TrapSort["field"]) {
  store.toggleSort(field);
}

function openTrap(trap: Trap) {
  router.push(`/traps/${trap.id}`);
}

function rowItems(trap: Trap) {
  return [
    { label: "Подробнее", icon: "i-lucide-eye", onSelect: () => openTrap(trap) },
    ...(canManage.value
      ? [
          {
            label: "Удалить",
            icon: "i-lucide-trash-2",
            color: "error" as const,
            onSelect: () => store.requestDelete(trap.id),
          },
        ]
      : []),
  ];
}
</script>

<template>
  <div
    class="overflow-x-auto rounded-lg border border-default bg-default/95 shadow-sm"
  >
    <table class="w-full text-left text-sm">
      <thead class="border-b border-default bg-muted/40">
        <tr>
          <th
            v-for="field in fields"
            :key="field.key"
            class="whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-muted"
          >
            <button
              v-if="field.sortable"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded transition-colors hover:text-highlighted"
              :class="sortIndicator(field.key) ? 'text-highlighted' : ''"
              @click.stop="toggleSort(field.key)"
            >
              {{ field.label }}
              <UIcon
                v-if="sortIndicator(field.key)"
                :name="sortIndicator(field.key)"
                class="size-3.5"
              />
            </button>
            <span v-else>{{ field.label }}</span>
          </th>
          <th class="w-10 px-2 py-2.5">
            <span class="sr-only">Действия</span>
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="trap in store.filteredTraps"
          :key="trap.id"
          tabindex="0"
          data-radial-ignore
          class="cursor-pointer border-b border-default transition-colors last:border-0 hover:bg-elevated/60"
          @click="openTrap(trap)"
          @keydown.enter="openTrap(trap)"
        >
          <td v-if="show('name')" class="px-4 py-2.5">
            <div class="flex items-center gap-2.5">
              <div
                class="flex size-8 shrink-0 items-center justify-center rounded-md border border-default bg-elevated"
              >
                <UIcon :name="profileIcon(trap)" class="size-4 text-primary" />
              </div>
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ trap.name }}
                </p>
                <p class="font-mono text-[10px] text-dimmed">{{ trap.id }}</p>
              </div>
            </div>
          </td>

          <td v-if="showProfileColumn" class="px-4 py-2.5">
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
              :label="profileName(trap)"
            />
          </td>

          <td v-if="show('services')" class="px-4 py-2.5">
            <div class="flex flex-wrap items-center gap-1">
              <span
                v-for="service in visibleServices(trap)"
                :key="service.key"
                class="inline-flex items-center gap-1 rounded-md border border-default bg-elevated/60 px-1.5 py-0.5 text-[11px] text-toned"
                :title="`${serviceMeta(service.key).label} · порт ${service.port}`"
              >
                <UIcon
                  :name="serviceMeta(service.key).icon"
                  class="size-3 text-muted"
                />
                {{ serviceMeta(service.key).label }}
              </span>
              <span v-if="!visibleServices(trap).length" class="text-xs text-dimmed">
                —
              </span>
            </div>
          </td>

          <td
            v-if="show('port')"
            class="px-4 py-2.5 font-mono text-xs text-toned tabular-nums"
          >
            {{ trap.services.map((service) => service.port).join(", ") }}
          </td>

          <td v-if="show('level')" class="px-4 py-2.5">
            <UBadge
              :color="levelInfo(trap).color"
              variant="subtle"
              size="sm"
              :label="levelInfo(trap).label"
            />
          </td>

          <td v-if="show('agent')" class="px-4 py-2.5">
            <span class="inline-flex items-center gap-2">
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="statusInfo(trap).dot"
              />
              <span class="text-xs text-toned">
                {{ statusInfo(trap).label }}
              </span>
            </span>
          </td>

          <td
            v-if="show('events')"
            class="px-4 py-2.5 font-mono text-xs tabular-nums"
          >
            <span :class="trap.eventsCount > 1000 ? 'text-primary' : 'text-toned'">
              {{ formatEvents(trap.eventsCount) }}
            </span>
          </td>

          <td
            v-if="show('createdAt')"
            class="px-4 py-2.5 font-mono text-xs text-muted"
          >
            {{ formatDate(trap.createdAt) }}
          </td>

          <td class="px-2 py-2.5 text-right" @click.stop>
            <UDropdownMenu
              :items="rowItems(trap)"
              :content="{ align: 'end', side: 'bottom', sideOffset: 6 }"
              :ui="{ content: 'w-44', item: 'cursor-pointer' }"
            >
              <UButton
                class="cursor-pointer"
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Действия"
              />
            </UDropdownMenu>
          </td>
        </tr>

        <tr v-if="!hasTraps">
          <td
            :colspan="fields.length + 1"
            class="px-4 py-12 text-center"
          >
            <div class="flex flex-col items-center gap-3">
              <div
                class="flex size-11 items-center justify-center rounded-lg border border-default bg-elevated"
              >
                <UIcon name="i-lucide-radar" class="size-5 text-dimmed" />
              </div>
              <div>
                <p class="text-sm font-semibold text-highlighted">
                  Ловушки не найдены
                </p>
                <p class="mt-1 text-xs text-muted">
                  Измените параметры поиска или создайте новую ловушку
                </p>
              </div>
              <UButton
                class="cursor-pointer"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-x"
                label="Сбросить фильтры"
                @click="
                  store.setSearch('');
                  store.setLevelFilter('all');
                  store.setAgentFilter('all');
                "
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div
      class="flex flex-wrap items-center justify-between gap-2 border-t border-default px-4 py-2.5 text-xs text-muted"
    >
      <span>
        Показано {{ store.filteredTraps.length }} из {{ store.traps.length }}
      </span>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          v-for="status in AGENT_STATUSES"
          :key="status.key"
          class="inline-flex items-center gap-1.5"
        >
          <span class="size-1.5 rounded-full" :class="status.dot" />
          {{ status.label }}
        </span>
      </div>
    </div>
  </div>
</template>
