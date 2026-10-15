import { defineStore } from "pinia";
import type { PermissionRead, RoleRead } from "~/types/api";
import { authApi } from "~/api/auth";
import { humanizeAuthError, toApiError } from "~/api/errors";
import { ADMIN_SERVICES } from "~/utils/admin";

export const useAdminStore = defineStore("admin", () => {
  const services = ADMIN_SERVICES;
  const activeServiceId = ref(ADMIN_SERVICES[0]!.id);

  const roles = ref<RoleRead[]>([]);
  const permissions = ref<PermissionRead[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let loaded = false;

  const activeService = computed(
    () =>
      services.find((service) => service.id === activeServiceId.value) ??
      services[0]!,
  );

  /** Права, сгруппированные по ресурсу (users, honeypots, ...). */
  const groupedPermissions = computed(() => {
    const map = new Map<string, PermissionRead[]>();

    for (const permission of permissions.value) {
      const list = map.get(permission.group) ?? [];
      list.push(permission);
      map.set(permission.group, list);
    }

    return [...map.entries()].map(([group, items]) => ({ group, items }));
  });

  function setService(id: string) {
    activeServiceId.value = id;
  }

  /** Загрузка ролей и справочника прав (нужен permission roles:read). */
  async function load(force = false): Promise<void> {
    if (loading.value || (!force && loaded)) return;

    loading.value = true;
    error.value = null;

    try {
      const [roleList, permissionList] = await Promise.all([
        authApi.roles({ force }),
        authApi.permissions({ force }),
      ]);

      roles.value = roleList;
      permissions.value = permissionList;
      loaded = true;
    } catch (err) {
      error.value = humanizeAuthError(toApiError(err));
    } finally {
      loading.value = false;
    }
  }

  return {
    services,
    activeServiceId,
    activeService,
    roles,
    permissions,
    groupedPermissions,
    loading,
    error,
    setService,
    load,
  };
});
