import type { AdminService } from "~/types/admin";

/** Человекочитаемые названия ролей API. */
export const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  operator: "Оператор",
  viewer: "Наблюдатель",
};

export function roleLabel(id: string) {
  return ROLE_LABELS[id] ?? id;
}

export const ADMIN_SERVICES: AdminService[] = [
  {
    id: "access",
    label: "Пользователи и роли",
    description: "Создание аккаунтов, ролей и разрешений",
    icon: "i-lucide-users-round",
    ready: true,
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
