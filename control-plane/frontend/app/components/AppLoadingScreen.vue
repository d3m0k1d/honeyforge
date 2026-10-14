<script setup lang="ts">
const steps = [
  "Инициализация ядра",
  "Сканирование ловушек",
  "Подключение сенсоров",
  "Загрузка сигнатур",
  "Синхронизация журналов",
  "Готово",
];

const step = ref(0);
const pct = ref(0);

let stepTimer: ReturnType<typeof setInterval> | undefined;
let pctTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  stepTimer = setInterval(() => {
    if (step.value < steps.length - 1) step.value += 1;
  }, 750);

  pctTimer = setInterval(() => {
    if (pct.value >= 100) {
      clearInterval(pctTimer);
      return;
    }
    pct.value = Math.min(100, pct.value + 3 + Math.floor(Math.random() * 8));
  }, 70);
});

onBeforeUnmount(() => {
  clearInterval(stepTimer);
  clearInterval(pctTimer);
});
</script>

<template>
  <div class="screen" role="status" aria-live="polite">
    <div class="grid-bg" />
    <div class="glow glow-a" />
    <div class="glow glow-b" />

    <div class="content">
      <RadarLoader size="clamp(190px, 46vw, 272px)" />

      <div class="brand">
        <span class="text-highlighted">Honeypot</span
        ><span class="text-primary"> Forge</span>
      </div>

      <p class="eyebrow">Платформа модерации honeypot-инцидентов</p>

      <div class="status">
        <span class="pulse" />
        <span class="label">{{ steps[step] }}</span>
        <span class="pct">{{ String(pct).padStart(3, "0") }}%</span>
      </div>

      <div class="bar">
        <span :style="{ width: `${pct}%` }" />
      </div>
    </div>

    <p class="foot">Локатор периметра · сканирование сектора</p>
  </div>
</template>

<style scoped>
.screen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--ui-bg);
}

.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(
      to right,
      color-mix(in oklab, var(--ui-text) 7%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      color-mix(in oklab, var(--ui-text) 7%, transparent) 1px,
      transparent 1px
    );
  background-size: 48px 48px;
  -webkit-mask-image: radial-gradient(
    circle at 50% 46%,
    black 0%,
    transparent 72%
  );
  mask-image: radial-gradient(circle at 50% 46%, black 0%, transparent 72%);
}

.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
}

.glow-a {
  top: -18vh;
  left: 50%;
  width: 60vw;
  height: 60vw;
  transform: translateX(-50%);
  background: color-mix(in oklab, var(--ui-primary) 14%, transparent);
}

.glow-b {
  bottom: -24vh;
  right: -12vw;
  width: 44vw;
  height: 44vw;
  background: color-mix(in oklab, var(--ui-primary) 8%, transparent);
}

.content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  padding: 24px;
  text-align: center;
}

.brand {
  font-size: clamp(20px, 5vw, 26px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
}

.eyebrow {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--ui-text-muted);
}

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 18px;
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--ui-text-toned);
}

.pulse {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--ui-primary);
  box-shadow: 0 0 0 0 color-mix(in oklab, var(--ui-primary) 70%, transparent);
  animation: hp-dot 1.4s ease-out infinite;
}

.label {
  min-width: 21ch;
  text-align: left;
}

.pct {
  color: var(--ui-text-dimmed);
}

.bar {
  width: min(320px, 72vw);
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklab, var(--ui-text) 12%, transparent);
}

.bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    to right,
    color-mix(in oklab, var(--ui-primary) 70%, transparent),
    var(--ui-primary)
  );
  box-shadow: 0 0 12px color-mix(in oklab, var(--ui-primary) 65%, transparent);
  transition: width 0.25s ease-out;
}

.foot {
  position: absolute;
  bottom: 26px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
  color: var(--ui-text-dimmed);
}

@keyframes hp-dot {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--ui-primary) 65%, transparent);
  }
  70% {
    box-shadow: 0 0 0 9px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
</style>
