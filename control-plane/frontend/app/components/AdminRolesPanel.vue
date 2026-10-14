<script setup lang="ts">
import type { Permission } from "~/types/admin";
import { PERMISSIONS, permissionLabel } from "~/utils/admin";

const admin = useAdminStore();
const toast = useToast();

const modalOpen = ref(false);

const form = reactive({
  name: "",
  description: "",
  permissions: [] as string[],
});

const canSubmit = computed(() => Boolean(form.name.trim()));

const groupedPermissions = computed(() => {
  const map = new Map<string, Permission[]>();

  for (const permission of PERMISSIONS) {
    const list = map.get(permission.group) ?? [];
    list.push(permission);
    map.set(permission.group, list);
  }

  return [...map.entries()].map(([group, items]) => ({ group, items }));
});

function isSeedRole(id: string) {
  return admin.seedRoleIds.includes(id);
}

function togglePermission(id: string, value: boolean) {
  form.permissions = value
    ? [...form.permissions, id]
    : form.permissions.filter((permission) => permission !== id);
}

watch(modalOpen, (open) => {
  if (!open) return;

  form.name = "";
  form.description = "";
  form.permissions = [];
});

function submit() {
  const created = admin.createRole({
    name: form.name,
    description: form.description,
    permissions: form.permissions,
  });

  if (!created) {
    toast.add({
      title: "Не удалось создать роль",
      description: "Проверьте название — роль с таким именем уже существует",
      color: "error",
      icon: "i-lucide-triangle-alert",
    });
    return;
  }

  toast.add({
    title: `Роль ${created.name} создана`,
    description: `Разрешений: ${created.permissions.length}`,
    color: "success",
    icon: "i-lucide-check",
  });

  modalOpen.value = false;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-shield-check" class="size-4 text-dimmed" />
        <span class="text-eyebrow">
          Роли
        </span>
        <UBadge color="neutral" variant="outline" size="sm">
          {{ admin.roles.length }}
        </UBadge>
      </div>
      <UButton
        class="cursor-pointer"
        icon="i-lucide-plus"
        label="Создать роль"
        size="sm"
        @click="modalOpen = true"
      />
    </div>

    <div class="space-y-3">
      <div
        v-for="role in admin.roles"
        :key="role.id"
        class="rounded-lg border border-default bg-elevated/40 p-4"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-highlighted">
                {{ role.name }}
              </span>
              <UBadge
                color="neutral"
                variant="outline"
                size="sm"
                :label="`${role.permissions.length} прав`"
              />
            </div>
            <p class="mt-0.5 text-xs text-muted">
              {{ role.description || "Без описания" }}
            </p>
          </div>

          <UButton
            v-if="!isSeedRole(role.id)"
            class="cursor-pointer"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            aria-label="Удалить роль"
            @click="admin.deleteRole(role.id)"
          />
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <UBadge
            v-for="permission in role.permissions"
            :key="permission"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="permissionLabel(permission)"
          />
          <span v-if="!role.permissions.length" class="text-xs text-dimmed">
            без разрешений
          </span>
        </div>
      </div>
    </div>

    <UModal
      v-model:open="modalOpen"
      title="Новая роль"
      description="Название, описание и набор разрешений"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <UFormField label="Название" required>
            <UInput
              v-model="form.name"
              placeholder="например, auditor"
              class="w-full font-mono"
              icon="i-lucide-tag"
              :ui="{ leading: 'pointer-events-none' }"
            />
          </UFormField>

          <UFormField label="Описание">
            <UTextarea
              v-model="form.description"
              placeholder="За что отвечает роль"
              class="w-full"
              :rows="2"
            />
          </UFormField>

          <div
            v-for="group in groupedPermissions"
            :key="group.group"
            class="space-y-2"
          >
            <span class="text-eyebrow">
              {{ group.group }}
            </span>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <UCheckbox
                v-for="permission in group.items"
                :key="permission.id"
                :model-value="form.permissions.includes(permission.id)"
                :label="permission.label"
                @update:model-value="
                  togglePermission(permission.id, $event)
                "
              />
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            class="cursor-pointer"
            color="neutral"
            variant="ghost"
            label="Отмена"
            @click="modalOpen = false"
          />
          <UButton
            class="cursor-pointer"
            icon="i-lucide-check"
            label="Создать"
            :disabled="!canSubmit"
            @click="submit"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
