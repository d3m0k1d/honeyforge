import type { AdminService, Permission } from "~/types/admin";

export const PERMISSIONS: Permission[] = [
  {
    id: "users.read",
    label: "Просмотр пользователей",
    group: "Пользователи",
  },
  {
    id: "users.write",
    label: "Создание и блокировка пользователей",
    group: "Пользователи",
  },
  {
    id: "roles.manage",
    label: "Управление ролями и разрешениями",
    group: "Пользователи",
  },
  {
    id: "incidents.read",
    label: "Просмотр инцидентов",
    group: "Инциденты",
  },
  {
    id: "incidents.write",
    label: "Закрытие и эскалация инцидентов",
    group: "Инциденты",
  },
  {
    id: "incidents.delete",
    label: "Удаление инцидентов",
    group: "Инциденты",
  },
  {
    id: "sensors.manage",
    label: "Управление honeypot-сенсорами",
    group: "Инфраструктура",
  },
  {
    id: "sensors.deploy",
    label: "Выкладка конфигураций сенсоров",
    group: "Инфраструктура",
  },
  {
    id: "logs.read",
    label: "Чтение журналов аудита",
    group: "Инфраструктура",
  },
  {
    id: "settings.manage",
    label: "Изменение системных настроек",
    group: "Инфраструктура",
  },
];

export const ADMIN_SERVICES: AdminService[] = [
  {
    id: "access",
    label: "Пользователи и роли",
    description: "Создание аккаунтов, ролей и разрешений",
    icon: "i-lucide-users-round",
    ready: true,
  },
  {
    id: "sensors",
    label: "Сенсоры",
    description: "Реестр honeypot-ловушек и их статусы",
    icon: "i-lucide-radar",
    ready: false,
  },
  {
    id: "incidents",
    label: "Инциденты",
    description: "Обработка зафиксированных атак",
    icon: "i-lucide-shield-alert",
    ready: false,
  },
  {
    id: "audit",
    label: "Журнал аудита",
    description: "История действий операторов",
    icon: "i-lucide-scroll-text",
    ready: false,
  },
  {
    id: "tokens",
    label: "API-токены",
    description: "Ключи доступа к внешним интеграциям",
    icon: "i-lucide-key-round",
    ready: false,
  },
  {
    id: "system",
    label: "Система",
    description: "Параметры платформы и обслуживание",
    icon: "i-lucide-server-cog",
    ready: false,
  },
];

export function permissionLabel(id: string) {
  return PERMISSIONS.find((permission) => permission.id === id)?.label ?? id;
}
