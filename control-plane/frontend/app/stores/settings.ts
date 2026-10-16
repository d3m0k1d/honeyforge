import { defineStore, skipHydrate } from "pinia";
import type {
  AppSettings,
  CustomTheme,
  NavMode,
  NotifySettings,
  ThemeId,
} from "~/utils/theme";
import {
  SETTINGS_KEY,
  applyThemeRuntime,
  defaultSettings,
  loadSettingsSnapshot,
} from "~/utils/theme";

export const useSettingsStore = defineStore("settings", () => {
  const defaults = defaultSettings();

  const themeId = ref<ThemeId>(defaults.themeId);
  const custom = reactive<CustomTheme>({ ...defaults.custom });
  const navMode = ref<NavMode>(defaults.navMode);
  const radialRadius = ref(defaults.radialRadius);
  const dashboard = ref<string[]>([...defaults.dashboard]);
  const defaultPeriod = ref<AppSettings["defaultPeriod"]>(
    defaults.defaultPeriod,
  );
  const notify = reactive<NotifySettings>({ ...defaults.notify });

  const loaded = ref(false);

  // SSR-пейлоад содержит только дефолты — не даём гидрации затереть
  // клиентские значения (иначе persist-наблюдатель запишет дефолты в LS
  // раньше, чем load() успеет прочитать сохранённые настройки)
  skipHydrate(themeId);
  skipHydrate(custom);
  skipHydrate(navMode);
  skipHydrate(radialRadius);
  skipHydrate(dashboard);
  skipHydrate(defaultPeriod);
  skipHydrate(notify);

  function snapshot(): AppSettings {
    return {
      themeId: themeId.value,
      custom: { ...custom },
      navMode: navMode.value,
      radialRadius: radialRadius.value,
      dashboard: [...dashboard.value],
      defaultPeriod: defaultPeriod.value,
      notify: { ...notify },
    };
  }

  function persist() {
    if (!import.meta.client) return;

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot()));
  }

  function applyTheme() {
    applyThemeRuntime(themeId.value, { ...custom });
  }

  function load() {
    if (!import.meta.client || loaded.value) return;

    const saved = loadSettingsSnapshot();

    themeId.value = saved.themeId;
    Object.assign(custom, saved.custom);
    navMode.value = saved.navMode;
    radialRadius.value = saved.radialRadius;
    dashboard.value = saved.dashboard;
    defaultPeriod.value = saved.defaultPeriod;
    Object.assign(notify, saved.notify);

    loaded.value = true;

    applyTheme();
  }

  function setTheme(id: ThemeId) {
    themeId.value = id;
  }

  function setCustom(partial: Partial<CustomTheme>) {
    Object.assign(custom, partial);
  }

  function setNavMode(mode: NavMode) {
    navMode.value = mode;
  }

  function toggleWidget(key: string) {
    dashboard.value = dashboard.value.includes(key)
      ? dashboard.value.filter((item) => item !== key)
      : [...dashboard.value, key];
  }

  function setDefaultPeriod(period: AppSettings["defaultPeriod"]) {
    defaultPeriod.value = period;
  }

  function setNotify(partial: Partial<NotifySettings>) {
    Object.assign(notify, partial);
  }

  function reset() {
    const fresh = defaultSettings();

    themeId.value = fresh.themeId;
    Object.assign(custom, fresh.custom);
    navMode.value = fresh.navMode;
    radialRadius.value = fresh.radialRadius;
    dashboard.value = [...fresh.dashboard];
    defaultPeriod.value = fresh.defaultPeriod;
    Object.assign(notify, fresh.notify);

    applyTheme();

    if (import.meta.client) {
      localStorage.removeItem(SETTINGS_KEY);
    }
  }

  watch(snapshot, () => {
    if (!loaded.value) return;
    persist();
  });

  watch(
    [themeId, () => custom.accent, () => custom.lightBg, () => custom.darkBg],
    applyTheme,
  );

  return {
    themeId,
    custom,
    navMode,
    radialRadius,
    dashboard,
    defaultPeriod,
    notify,
    load,
    setTheme,
    setCustom,
    setNavMode,
    toggleWidget,
    setDefaultPeriod,
    setNotify,
    reset,
  };
});
