<script setup lang="ts">
export interface RadialMenuItem {
  icon: string;
  label: string;
  to: string;
}

const props = withDefaults(
  defineProps<{
    items: RadialMenuItem[];
    radius?: number;
    hint?: string;
    safeRadius?: number;
    enabled?: boolean;
  }>(),
  {
    radius: 190,
    hint: "Нажмите ЛКМ по любой области",
    safeRadius: 12,
    enabled: true,
  },
);

const open = ref(false);
const revealed = ref(false);
const center = ref({ x: 0, y: 0 });
const menuRadius = ref(190);
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let pressPoint: { x: number; y: number } | null = null;
let dragged = false;

const DRAG_THRESHOLD = 4;
const ITEM_SIZE = 48;
const EDGE_MARGIN = 12;
// Нативные интерактивные элементы + ARIA-роли, которые используют Nuxt UI/Reka
// (опции select, пункты меню, чекбоксы и т.д. рендерятся как div с ролью)
const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "details",
  "[contenteditable]",
  "[data-radial-ignore]",
  "[role='button']",
  "[role='combobox']",
  "[role='option']",
  "[role='listbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='slider']",
  "[role='spinbutton']",
  "[aria-haspopup]",
].join(",");
const SAFE_ZONE_PROBES = 8;

function isInteractive(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  return Boolean(target.closest(INTERACTIVE_SELECTOR));
}

// Оверлеи (dropdown, select, modal, popover) телепортируются в body —
// клики по ним не должны открывать радиальное меню
function isPortalElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  const root = document.getElementById("__nuxt");

  if (!root) return false;

  return !root.contains(target);
}

function isInteractiveAt(x: number, y: number) {
  return document
    .elementsFromPoint(x, y)
    .some((element) => element.matches(INTERACTIVE_SELECTOR));
}

function isNearInteractive(event: MouseEvent) {
  if (isInteractive(event.target)) return true;

  const radius = props.safeRadius;

  if (!radius) return false;

  const step = (Math.PI * 2) / SAFE_ZONE_PROBES;

  for (let i = 0; i < SAFE_ZONE_PROBES; i++) {
    const angle = step * i;

    if (
      isInteractiveAt(
        event.clientX + Math.cos(angle) * radius,
        event.clientY + Math.sin(angle) * radius,
      )
    ) {
      return true;
    }
  }

  return false;
}

function onPointerDown(event: PointerEvent) {
  pressPoint = { x: event.clientX, y: event.clientY };
  dragged = false;
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerUp() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
}

function onPointerMove(event: PointerEvent) {
  if (!pressPoint || dragged) return;

  const dx = event.clientX - pressPoint.x;
  const dy = event.clientY - pressPoint.y;

  dragged = Math.hypot(dx, dy) > DRAG_THRESHOLD;
}

function onDocumentClick(event: MouseEvent) {
  if (!props.enabled) return;

  const wasDragged = dragged;

  pressPoint = null;
  dragged = false;

  if (
    open.value ||
    wasDragged ||
    isPortalElement(event.target) ||
    isNearInteractive(event)
  )
    return;

  onTrigger(event);
}

const positioned = computed(() => {
  const count = props.items.length || 1;

  return props.items.map((item, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;

    return {
      ...item,
      angle,
      x: Math.cos(angle) * menuRadius.value,
      y: Math.sin(angle) * menuRadius.value,
    };
  });
});

// Роза меню не должна выходить за пределы экрана:
// радиус сжимается под маленькие вьюпорты, центр смещается от краёв
function fitToViewport(x: number, y: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const halfItem = ITEM_SIZE / 2;
  const available = Math.floor(Math.min(vw, vh) / 2) - halfItem - EDGE_MARGIN;
  const radius = Math.max(72, Math.min(props.radius, available));
  const half = radius + halfItem + EDGE_MARGIN;

  return {
    x: Math.min(Math.max(x, half), Math.max(half, vw - half)),
    y: Math.min(Math.max(y, half), Math.max(half, vh - half)),
    radius,
  };
}

function onTrigger(event: MouseEvent) {
  const fitted = fitToViewport(event.clientX, event.clientY);

  center.value = { x: fitted.x, y: fitted.y };
  menuRadius.value = fitted.radius;
  revealed.value = false;
  open.value = true;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      revealed.value = true;
    });
  });
}

function close() {
  if (!open.value) return;

  revealed.value = false;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    open.value = false;
  }, 320);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(open, (value) => {
  if (import.meta.client) {
    if (value) {
      window.addEventListener("keydown", onKeydown);
      window.addEventListener("resize", close);
    } else {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", close);
    }
  }
});

onMounted(() => {
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("click", onDocumentClick);
});

onBeforeUnmount(() => {
  clearTimeout(closeTimer);
  onPointerUp();
  window.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("click", onDocumentClick);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    v-if="hint"
    class="pointer-events-none fixed inset-0 z-30 flex items-center justify-center select-none"
  ></div>

  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50">
      <div
        class="absolute inset-0 bg-default/60 backdrop-blur-sm transition-opacity duration-300"
        :class="revealed ? 'opacity-100' : 'opacity-0'"
        @click="close"
      />

      <div
        class="absolute"
        :style="{ left: `${center.x}px`, top: `${center.y}px` }"
      >
        <span
          class="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-opacity duration-300"
          :class="revealed ? 'opacity-100' : 'opacity-0'"
        />

        <div
          v-for="(item, i) in positioned"
          :key="`line-${item.to}`"
          class="pointer-events-none absolute h-px origin-left bg-linear-to-r from-primary/70 via-primary/40 to-primary/10 transition-[width,opacity] duration-500 ease-out"
          :style="{
            transform: `rotate(${item.angle}rad)`,
            width: revealed ? `${menuRadius}px` : '0px',
            opacity: revealed ? 1 : 0,
            transitionDelay: `${i * 40}ms`,
          }"
        />

        <div
          v-for="(item, i) in positioned"
          :key="item.to"
          class="absolute transition-all duration-300 ease-out"
          :style="{
            left: 0,
            top: 0,
            transform: revealed
              ? `translate(calc(-50% + ${item.x}px), calc(-50% + ${item.y}px))`
              : 'translate(-50%, -50%)',
            opacity: revealed ? 1 : 0,
            transitionDelay: `${i * 40 + 80}ms`,
          }"
        >
          <NuxtLink
            :to="item.to"
            class="group relative flex size-12 items-center justify-center rounded-full border border-default bg-elevated text-muted shadow-lg transition-all duration-200 ease-out hover:scale-110 hover:border-primary hover:text-primary hover:shadow-primary/20"
            @click="close"
          >
            <UIcon :name="item.icon" class="size-5" />
            <span
              class="pointer-events-none absolute top-full mt-2 whitespace-nowrap rounded-md border border-default bg-default px-2 py-1 text-[11px] font-medium text-toned opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            >
              {{ item.label }}
            </span>
          </NuxtLink>
        </div>
      </div>
    </div>
  </Teleport>
</template>
