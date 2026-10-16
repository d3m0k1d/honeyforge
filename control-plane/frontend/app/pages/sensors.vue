<script setup lang="ts">
definePageMeta({ permission: "agents:read" });

import { formatDateTime } from "~/utils/traps";

const store = useAgentsStore();
onMounted(() => store.load());
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-eyebrow">Мониторинг · HoneypotForge</p>
        <h1 class="mt-1 text-lg font-semibold tracking-tight text-highlighted">Сенсоры</h1>
        <p class="mt-1 text-sm text-muted">Агенты платформы и последний полученный heartbeat.</p>
      </div>
      <UButton label="Обновить" icon="i-lucide-refresh-cw" variant="outline" :loading="store.pending" @click="store.load()" />
    </div>
    <UAlert v-if="store.error" color="error" title="Не удалось загрузить агентов" :description="store.error" />
    <p v-if="store.pending" role="status" class="text-sm text-muted">Загрузка агентов…</p>
    <template v-else-if="store.loaded && !store.error">
      <p class="text-xs text-muted">Агентов: {{ store.agents.length }} · Онлайн: {{ store.onlineCount }}</p>
      <div class="overflow-x-auto rounded-lg border border-default bg-default/95">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-default bg-muted/40 text-xs text-muted">
            <tr>
              <th class="px-4 py-3">ID агента</th>
              <th class="px-4 py-3">Профиль</th>
              <th class="px-4 py-3">Регистрация</th>
              <th class="px-4 py-3">Последний heartbeat</th>
              <th class="px-4 py-3">Статус</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agent in store.agents" :key="agent.agent_id" class="border-b border-default last:border-0">
              <td class="px-4 py-3 font-mono text-xs text-highlighted">{{ agent.agent_id }}</td>
              <td class="px-4 py-3 text-xs">{{ agent.profile_name ?? agent.profile_id ?? '—' }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-xs">{{ agent.enrolled_at ? formatDateTime(agent.enrolled_at) : '—' }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-xs">{{ agent.last_heartbeat_at ? formatDateTime(agent.last_heartbeat_at) : '—' }}</td>
              <td class="px-4 py-3"><UBadge :color="agent.online ? 'success' : 'neutral'" variant="subtle" :label="agent.online ? 'Online' : 'Offline'" /></td>
            </tr>
            <tr v-if="!store.agents.length"><td colspan="5" class="px-4 py-12 text-center text-sm text-muted">Агенты не зарегистрированы</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
