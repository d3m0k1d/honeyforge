<script setup lang="ts">
const auth = useAuthStore();

const fields = computed(() => [
  { label: "Логин", value: auth.user?.login ?? "—" },
  { label: "ID пользователя", value: auth.user?.id ?? "—" },
  {
    label: "Роли",
    value: auth.user?.roles.length
      ? auth.user.roles.join(", ")
      : "не назначены",
  },
  {
    label: "Дата регистрации",
    value: auth.user?.createdAt
      ? new Date(auth.user.createdAt).toLocaleString("ru-RU")
      : "—",
  },
]);
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5">
    <div class="border-b border-default pb-3">
      <h1 class="text-lg font-semibold tracking-tight text-highlighted">
        Профиль
      </h1>
      <p class="text-eyebrow mt-1">
        Учётная запись оператора
      </p>
    </div>

    <UCard :ui="{ body: 'space-y-4' }">
      <div class="flex items-center gap-3">
        <div
          class="flex size-11 items-center justify-center rounded-full border border-default bg-elevated"
        >
          <UIcon name="i-lucide-user-round" class="size-5 text-primary" />
        </div>
        <div>
          <p class="text-sm font-semibold text-highlighted">
            {{ auth.user?.login }}
          </p>
          <p class="text-xs text-muted">демо-режим · offline-аккаунт</p>
        </div>
      </div>

      <dl class="divide-y divide-default rounded-lg border border-default">
        <div
          v-for="field in fields"
          :key="field.label"
          class="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
        >
          <dt class="text-muted">{{ field.label }}</dt>
          <dd class="font-mono text-xs text-highlighted">
            {{ field.value }}
          </dd>
        </div>
      </dl>

      <p class="text-xs text-dimmed">
        Раздел находится в разработке. Здесь появятся настройки профиля,
        права доступа и журнал активности оператора.
      </p>
    </UCard>
  </div>
</template>
