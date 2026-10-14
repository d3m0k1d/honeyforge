import {
  applyThemeRuntime,
  loadSettingsSnapshot,
} from "~/utils/theme";

export default defineNuxtPlugin(() => {
  const settings = loadSettingsSnapshot();

  applyThemeRuntime(settings.themeId, settings.custom);
});
