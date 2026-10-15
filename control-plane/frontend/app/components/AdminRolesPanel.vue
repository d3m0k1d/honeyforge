<script setup lang="ts">
import { roleLabel } from "~/utils/admin";

const admin = useAdminStore();

function hasPermission(rolePermissions: string[], permission: string) {
  return rolePermissions.includes(permission);
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-shield-check" class="size-4 text-dimmed" />
        <span class="text-eyebrow">Роли и разрешения</span>
        <UBadge color="neutral" variant="outline" size="sm">
          {{ admin.roles.length }}
        </UBadge>
      </div>
      <UBadge color="neutral" variant="outline" size="sm">
        {{ admin.permissions.length }} прав
      </UBadge>
    </div>

    <UAlert
      v-if="admin.error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="admin.error"
    />

    <div
      v-if="admin.loading && !admin.roles.length"
      class="flex items-center justify-center gap-2 rounded-lg border border-default py-8"
    >
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-dimmed" />
      <span class="text-xs text-muted">Загрузка ролей…</span>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="role in admin.roles"
        :key="role.name"
        class="rounded-lg border border-default bg-elevated/40 p-4"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold text-highlighted">
            {{ roleLabel(role.name) }}
          </span>
          <UBadge color="neutral" variant="outline" size="sm" :label="role.name" />
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
            :label="`${role.permissions.length} прав`"
          />
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UBadge
            v-for="permission in role.permissions"
            :key="permission"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="permission"
          />
          <span v-if="!role.permissions.length" class="text-xs text-dimmed">
            без разрешений
          </span>
        </div>
      </div>

      <div
        v-if="admin.groupedPermissions.length && admin.roles.length"
        class="overflow-x-auto rounded-lg border border-default"
      >
        <table class="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr class="border-b border-default bg-muted/30">
              <th class="px-4 py-2.5 font-medium text-muted">Разрешение</th>
              <th
                v-for="role in admin.roles"
                :key="role.name"
                class="px-3 py-2.5 text-center font-medium text-muted"
              >
                {{ roleLabel(role.name) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in admin.groupedPermissions" :key="group.group">
              <tr class="border-b border-default bg-elevated/40">
                <td
                  :colspan="admin.roles.length + 1"
                  class="px-4 py-1.5 text-eyebrow"
                >
                  {{ group.group }}
                </td>
              </tr>
              <tr
                v-for="permission in group.items"
                :key="permission.name"
                class="border-b border-default/60 last:border-0"
              >
                <td class="px-4 py-2 font-mono text-[11px] text-highlighted">
                  {{ permission.name }}
                </td>
                <td
                  v-for="role in admin.roles"
                  :key="role.name"
                  class="px-3 py-2 text-center"
                >
                  <UIcon
                    v-if="hasPermission(role.permissions, permission.name)"
                    name="i-lucide-check"
                    class="size-4 text-success"
                  />
                  <UIcon v-else name="i-lucide-minus" class="size-4 text-dimmed" />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
