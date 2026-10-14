import { defineStore } from "pinia";
import type { Role } from "~/types/admin";
import { ADMIN_SERVICES, PERMISSIONS } from "~/utils/admin";
import { createId } from "~/utils/schema";

const ROLES_KEY = "honeypotforge:roles";
const ALL_PERMISSIONS = PERMISSIONS.map((permission) => permission.id);

const SEED_ROLES: Role[] = [
  {
    id: "admin",
    name: "admin",
    description: "Полный доступ ко всем сервисам платформы",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    id: "operator",
    name: "operator",
    description: "Обслуживание сенсоров и разбор инцидентов",
    permissions: [
      "users.read",
      "incidents.read",
      "incidents.write",
      "sensors.manage",
      "sensors.deploy",
      "logs.read",
    ],
  },
  {
    id: "analyst",
    name: "analyst",
    description: "Только наблюдение за инцидентами и журналами",
    permissions: ["incidents.read", "logs.read"],
  },
];

function isClient() {
  return import.meta.client;
}

function readCustomRoles(): Role[] {
  if (!isClient()) return [];

  try {
    const raw = localStorage.getItem(ROLES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? (parsed as Role[]) : [];
  } catch {
    return [];
  }
}

function writeRoles(list: Role[]) {
  if (!isClient()) return;

  localStorage.setItem(ROLES_KEY, JSON.stringify(list));
}

export const useAdminStore = defineStore("admin", () => {
  const services = ADMIN_SERVICES;
  const activeServiceId = ref(ADMIN_SERVICES[0]!.id);
  const customRoles = ref<Role[]>([]);

  const roles = computed(() => [...customRoles.value, ...SEED_ROLES]);

  const activeService = computed(
    () =>
      services.find((service) => service.id === activeServiceId.value) ??
      services[0]!,
  );

  const seedRoleIds = computed(() => SEED_ROLES.map((role) => role.id));

  function roleName(id: string) {
    return roles.value.find((role) => role.id === id)?.name ?? id;
  }

  function loadRoles() {
    customRoles.value = readCustomRoles();
  }

  function setService(id: string) {
    activeServiceId.value = id;
  }

  function createRole(input: {
    name: string;
    description: string;
    permissions: string[];
  }) {
    const name = input.name.trim();

    if (!name) return null;

    if (
      roles.value.some((role) => role.name.toLowerCase() === name.toLowerCase())
    ) {
      return null;
    }

    const role: Role = {
      id: createId("role"),
      name,
      description: input.description.trim(),
      permissions: [...input.permissions],
    };

    customRoles.value = [...customRoles.value, role];
    writeRoles(customRoles.value);

    return role;
  }

  function deleteRole(id: string) {
    customRoles.value = customRoles.value.filter((role) => role.id !== id);
    writeRoles(customRoles.value);
  }

  return {
    services,
    activeServiceId,
    activeService,
    seedRoleIds,
    roles,
    roleName,
    loadRoles,
    setService,
    createRole,
    deleteRole,
  };
});
