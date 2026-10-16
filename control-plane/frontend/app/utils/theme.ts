export type ThemeId =
  | "forge"
  | "ocean"
  | "amethyst"
  | "solar"
  | "rose"
  | "cyan"
  | "custom";

export type NavMode = "radial" | "header";

export interface ThemePreset {
  id: ThemeId;
  name: string;
  hint: string;
  hue: number;
  chroma: number;
  chromaDark: number;
  swatch: string;
}

export interface CustomTheme {
  accent: string;
  lightBg: string;
  darkBg: string;
}

export interface NotifySettings {
  enabled: boolean;
  chat: string;
  critical: boolean;
  warning: boolean;
  daily: boolean;
}

export interface AppSettings {
  themeId: ThemeId;
  custom: CustomTheme;
  navMode: NavMode;
  radialRadius: number;
  dashboard: string[];
  defaultPeriod: "24h" | "7d" | "30d" | "all";
  notify: NotifySettings;
}

export const SETTINGS_KEY = "honeypotforge:settings";

export const THEMES: ThemePreset[] = [
  {
    id: "forge",
    name: "Форж",
    hint: "зелёный · дефолт",
    hue: 82,
    chroma: 0.1,
    chromaDark: 0.085,
    swatch: "#84cc16",
  },
  {
    id: "ocean",
    name: "Океан",
    hint: "синий",
    hue: 260,
    chroma: 0.13,
    chromaDark: 0.1,
    swatch: "#3b82f6",
  },
  {
    id: "amethyst",
    name: "Аметист",
    hint: "фиолетовый",
    hue: 294,
    chroma: 0.14,
    chromaDark: 0.11,
    swatch: "#a855f7",
  },
  {
    id: "solar",
    name: "Соляр",
    hint: "янтарный",
    hue: 70,
    chroma: 0.15,
    chromaDark: 0.12,
    swatch: "#f59e0b",
  },
  {
    id: "rose",
    name: "Роза",
    hint: "розово-красный",
    hue: 15,
    chroma: 0.15,
    chromaDark: 0.12,
    swatch: "#f43f5e",
  },
  {
    id: "cyan",
    name: "Бирюза",
    hint: "голубой",
    hue: 220,
    chroma: 0.12,
    chromaDark: 0.1,
    swatch: "#06b6d4",
  },
];

export const DEFAULT_CUSTOM: CustomTheme = {
  accent: "#10b981",
  lightBg: "#f7f6f4",
  darkBg: "#12110d",
};

export const DASHBOARD_WIDGETS: {
  key: string;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    key: "kpi",
    label: "KPI-лента",
    description: "Ловушки, агенты, события и критичные попадания",
    icon: "i-lucide-gauge",
  },
  {
    key: "activity",
    label: "Активность ловушек",
    description: "Линейный график событий в реальном времени",
    icon: "i-lucide-chart-line",
  },
  {
    key: "vectors",
    label: "Векторы атак",
    description: "Круговая диаграмма типов атак",
    icon: "i-lucide-chart-pie",
  },
  {
    key: "services",
    label: "Цели по сервисам",
    description: "Столбцы попаданий по протоколам",
    icon: "i-lucide-chart-column",
  },
  {
    key: "events",
    label: "Последние события",
    description: "Лента журнала перехваченных соединений",
    icon: "i-lucide-list",
  },
];

export function defaultSettings(): AppSettings {
  return {
    themeId: "forge",
    custom: { ...DEFAULT_CUSTOM },
    navMode: "radial",
    radialRadius: 190,
    dashboard: DASHBOARD_WIDGETS.map((widget) => widget.key),
    defaultPeriod: "7d",
    notify: {
      enabled: true,
      chat: "",
      critical: true,
      warning: false,
      daily: true,
    },
  };
}

export function loadSettingsSnapshot(): AppSettings {
  const fallback = defaultSettings();

  if (!import.meta.client) return fallback;

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object") return fallback;

    return {
      themeId: parsed.themeId ?? fallback.themeId,
      custom: { ...fallback.custom, ...(parsed.custom ?? {}) },
      navMode: parsed.navMode === "header" ? "header" : "radial",
      radialRadius: Number(parsed.radialRadius) || fallback.radialRadius,
      dashboard: Array.isArray(parsed.dashboard)
        ? parsed.dashboard.filter((key: unknown) =>
            DASHBOARD_WIDGETS.some((widget) => widget.key === key),
          )
        : fallback.dashboard,
      defaultPeriod: parsed.defaultPeriod ?? fallback.defaultPeriod,
      notify: { ...fallback.notify, ...(parsed.notify ?? {}) },
    };
  } catch {
    return fallback;
  }
}

/* ─── цветовые преобразования ─── */

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;

  const int = Number.parseInt(full, 16);

  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

export function hexToHsl(hex: string) {
  const { r, g, b } = hexToRgb(hex);

  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;

  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;

  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));

    if (max === rr) h = ((gg - bb) / delta) % 6;
    else if (max === gg) h = (bb - rr) / delta + 2;
    else h = (rr - gg) / delta + 4;

    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: s * 100, l: l * 100 };
}

function srgbToLinear(channel: number) {
  const c = channel / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToOklch(hex: string) {
  const { r, g, b } = hexToRgb(hex);

  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  const L = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const bb = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  const chroma = Math.hypot(a, bb);

  let hue = (Math.atan2(bb, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;

  return { l: L, c: chroma, h: hue };
}

/* ─── производные поверхности для кастомной темы ─── */

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%)`;
}

export function deriveSurfaces(hex: string) {
  const { h, s, l } = hexToHsl(hex);
  const tint = Math.min(s, 12);
  const light = l >= 55;

  return {
    light: {
      "--ui-bg": hsl(h, tint, l),
      "--ui-bg-muted": hsl(h, tint, l - 3),
      "--ui-bg-elevated": hsl(h, tint, l + 4),
      "--ui-bg-accented": hsl(h, tint, l - 8),
      "--ui-bg-inverted": hsl(h, tint, light ? 12 : 96),
      "--ui-text-dimmed": hsl(h, tint + 4, light ? 66 : 47),
      "--ui-text-muted": hsl(h, tint + 4, light ? 50 : 60),
      "--ui-text-toned": hsl(h, tint + 6, light ? 36 : 73),
      "--ui-text": hsl(h, tint + 6, light ? 27 : 85),
      "--ui-text-highlighted": hsl(h, tint + 6, light ? 14 : 96),
      "--ui-text-inverted": hsl(h, tint + 4, light ? 97 : 14),
      "--ui-border": hsl(h, tint, light ? l - 9 : l + 12),
      "--ui-border-muted": hsl(h, tint, light ? l - 5 : l + 8),
      "--ui-border-accented": hsl(h, tint, light ? l - 13 : l + 16),
      "--ui-border-inverted": hsl(h, tint + 6, light ? 14 : 96),
    },
    dark: {
      "--ui-bg": hsl(h, tint, l),
      "--ui-bg-muted": hsl(h, tint, l + 3),
      "--ui-bg-elevated": hsl(h, tint, l + 6),
      "--ui-bg-accented": hsl(h, tint, l + 10),
      "--ui-bg-inverted": hsl(h, tint, light ? 12 : 96),
      "--ui-text-dimmed": hsl(h, tint + 4, light ? 66 : 47),
      "--ui-text-muted": hsl(h, tint + 4, light ? 50 : 60),
      "--ui-text-toned": hsl(h, tint + 6, light ? 36 : 73),
      "--ui-text": hsl(h, tint + 6, light ? 27 : 85),
      "--ui-text-highlighted": hsl(h, tint + 6, light ? 14 : 96),
      "--ui-text-inverted": hsl(h, tint + 4, light ? 97 : 14),
      "--ui-border": hsl(h, tint, light ? l - 12 : l + 12),
      "--ui-border-muted": hsl(h, tint, light ? l - 8 : l + 8),
      "--ui-border-accented": hsl(h, tint, light ? l - 16 : l + 16),
      "--ui-border-inverted": hsl(h, tint + 6, light ? 14 : 96),
    },
  };
}

function toStyleBlock(vars: Record<string, string>) {
  return Object.entries(vars)
    .map(([key, value]) => `${key}: ${value};`)
    .join(" ");
}

export function applyThemeRuntime(themeId: ThemeId, custom: CustomTheme) {
  if (!import.meta.client) return;

  const root = document.documentElement;
  const preset = THEMES.find((theme) => theme.id === themeId);

  const accent =
    themeId === "custom"
      ? hexToOklch(custom.accent)
      : { h: preset?.hue ?? 82, c: preset?.chroma ?? 0.1 };

  const chroma = clamp(accent.c, 0.04, 0.2);
  const chromaDark = themeId === "custom" ? clamp(chroma * 0.85, 0.04, 0.17) : (preset?.chromaDark ?? 0.085);

  root.style.setProperty("--brand-hue", `${accent.h.toFixed(1)}deg`);
  root.style.setProperty("--brand-chroma", String(chroma.toFixed(3)));
  root.style.setProperty("--brand-chroma-dark", String(chromaDark.toFixed(3)));

  if (themeId === "custom") {
    root.classList.add("theme-custom");

    const surfaces = deriveSurfaces(custom.lightBg);
    const darkSurfaces = deriveSurfaces(custom.darkBg);

    let style = document.getElementById("theme-custom-style");

    if (!style) {
      style = document.createElement("style");
      style.id = "theme-custom-style";
      document.head.appendChild(style);
    }

    style.textContent = [
      `html.theme-custom:not(.dark) { ${toStyleBlock(surfaces.light)} }`,
      `html.theme-custom.dark { ${toStyleBlock(darkSurfaces.dark)} }`,
    ].join("\n");
  } else {
    root.classList.remove("theme-custom");
    document.getElementById("theme-custom-style")?.remove();
  }
}
