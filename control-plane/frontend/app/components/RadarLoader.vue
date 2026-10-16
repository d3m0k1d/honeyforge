<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: string | number
    spin?: number
    blips?: boolean
  }>(),
  { size: 240, spin: 4, blips: true },
);

const px = (v: string | number) => (typeof v === "number" ? `${v}px` : v);

const ticks = Array.from({ length: 24 }, (_, i) => i * 15);

const blipDefs = [
  { a: 45, r: "36%" },
  { a: 150, r: "30%" },
  { a: 245, r: "42%" },
  { a: 310, r: "24%" },
];

function blipDelay(a: number) {
  const raw = (props.spin * a) / 360 - props.spin * 0.05;
  return (((raw % props.spin) + props.spin) % props.spin).toFixed(2);
}
</script>

<template>
  <div
    class="radar"
    :style="{ width: px(props.size), height: px(props.size) }"
    aria-hidden="true"
  >
    <div class="halo" />

    <svg class="grid" viewBox="0 0 200 200" fill="none">
      <circle cx="100" cy="100" r="96" class="ring ring-outer" />
      <circle cx="100" cy="100" r="72" class="ring" />
      <circle cx="100" cy="100" r="72" class="ring ring-dashed" />
      <circle cx="100" cy="100" r="48" class="ring" />
      <circle cx="100" cy="100" r="24" class="ring ring-dashed" />

      <line x1="100" y1="10" x2="100" y2="190" class="axis" />
      <line x1="10" y1="100" x2="190" y2="100" class="axis" />

      <line
        v-for="t in ticks"
        :key="t"
        x1="100"
        y1="4"
        x2="100"
        y2="11"
        class="tick"
        :transform="`rotate(${t} 100 100)`"
      />

      <text x="100" y="22" text-anchor="middle" class="lbl">000</text>
      <text x="184" y="103" text-anchor="middle" class="lbl">090</text>
      <text x="100" y="184" text-anchor="middle" class="lbl">180</text>
      <text x="16" y="103" text-anchor="middle" class="lbl">270</text>
    </svg>

    <div class="sweep" :style="{ animationDuration: `${props.spin}s` }">
      <span class="beam" />
    </div>

    <div class="rim" />

    <template v-if="props.blips">
      <div
        v-for="b in blipDefs"
        :key="b.a"
        class="track"
        :style="{ '--a': `${b.a}deg`, '--r': b.r }"
      >
        <span
          class="blip"
          :style="{
            '--bd': `${props.spin}s`,
            '--bl': `${blipDelay(b.a)}s`,
          }"
        />
      </div>
    </template>

    <span class="core" :style="{ animationDuration: `${props.spin}s` }" />
  </div>
</template>

<style scoped>
.radar {
  position: relative;
  flex: none;
}

.halo {
  position: absolute;
  inset: -14%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in oklab, var(--ui-primary) 16%, transparent) 0%,
    color-mix(in oklab, var(--ui-primary) 5%, transparent) 42%,
    transparent 70%
  );
  animation: hp-breathe 4s ease-in-out infinite;
}

.grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.ring {
  stroke: color-mix(in oklab, var(--ui-text) 16%, transparent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.ring-outer {
  stroke: color-mix(in oklab, var(--ui-primary) 55%, transparent);
}

.ring-dashed {
  stroke-dasharray: 3 6;
  stroke: color-mix(in oklab, var(--ui-text) 24%, transparent);
}

.axis {
  stroke: color-mix(in oklab, var(--ui-primary) 30%, transparent);
  stroke-width: 1;
  stroke-dasharray: 2 6;
  vector-effect: non-scaling-stroke;
}

.tick {
  stroke: color-mix(in oklab, var(--ui-text) 34%, transparent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.lbl {
  fill: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 7px;
  font-weight: 500;
  letter-spacing: 0.14em;
}

.sweep {
  position: absolute;
  inset: 2%;
  overflow: hidden;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 268deg,
    color-mix(in oklab, var(--ui-primary) 10%, transparent) 300deg,
    color-mix(in oklab, var(--ui-primary) 34%, transparent) 332deg,
    color-mix(in oklab, var(--ui-primary) 72%, transparent) 354deg,
    color-mix(in oklab, var(--ui-primary) 95%, transparent) 360deg
  );
  animation: hp-spin linear infinite;
}

.beam {
  position: absolute;
  top: 0;
  left: 50%;
  width: 2px;
  height: 50%;
  transform: translateX(-50%);
  background: linear-gradient(
    to bottom,
    color-mix(in oklab, var(--ui-primary) 100%, transparent),
    color-mix(in oklab, var(--ui-primary) 55%, transparent)
  );
  box-shadow: 0 0 10px color-mix(in oklab, var(--ui-primary) 65%, transparent);
}

.rim {
  position: absolute;
  inset: -7%;
  border-radius: 50%;
  border: 1px dashed color-mix(in oklab, var(--ui-primary) 38%, transparent);
  border-top-color: color-mix(in oklab, var(--ui-primary) 95%, transparent);
  border-left-color: color-mix(in oklab, var(--ui-primary) 12%, transparent);
  animation: hp-spin-rev 22s linear infinite;
}

.track {
  position: absolute;
  inset: 0;
  transform: rotate(var(--a));
  pointer-events: none;
}

.blip {
  position: absolute;
  left: 50%;
  top: calc(50% - var(--r));
  width: 4.6%;
  height: 4.6%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: var(--ui-primary);
  opacity: 0.16;
  animation-name: hp-blip;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-duration: var(--bd, 4s);
  animation-delay: var(--bl, 0s);
  will-change: opacity, transform;
}

.blip::after {
  content: "";
  position: absolute;
  inset: -70%;
  border-radius: 50%;
  border: 1px solid color-mix(in oklab, var(--ui-primary) 70%, transparent);
  opacity: 0;
  animation-name: hp-blip-ring;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-duration: var(--bd, 4s);
  animation-delay: var(--bl, 0s);
}

.core {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6.5%;
  height: 6.5%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: var(--ui-primary);
  box-shadow: 0 0 18px color-mix(in oklab, var(--ui-primary) 70%, transparent);
  animation: hp-spin-pulse linear infinite;
}

.core::after {
  content: "";
  position: absolute;
  inset: -30%;
  border-radius: 50%;
  border: 1.5px solid color-mix(in oklab, var(--ui-primary) 90%, transparent);
}

@keyframes hp-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes hp-spin-rev {
  to {
    transform: rotate(-360deg);
  }
}

@keyframes hp-spin-pulse {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    transform: translate(-50%, -50%) scale(0.86);
  }
}

@keyframes hp-blip {
  0%,
  1.5% {
    opacity: 0.16;
    transform: translate(-50%, -50%) scale(0.7);
  }
  5% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.3);
  }
  22% {
    opacity: 0.5;
    transform: translate(-50%, -50%) scale(1);
  }
  45%,
  100% {
    opacity: 0.16;
    transform: translate(-50%, -50%) scale(0.7);
  }
}

@keyframes hp-blip-ring {
  0%,
  4% {
    opacity: 0;
    transform: scale(0.5);
  }
  7% {
    opacity: 0.85;
    transform: scale(1);
  }
  30%,
  100% {
    opacity: 0;
    transform: scale(1.7);
  }
}

@keyframes hp-breathe {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.97);
  }
  50% {
    opacity: 1;
    transform: scale(1.03);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sweep,
  .rim,
  .blip,
  .core,
  .halo {
    animation-duration: 14s !important;
  }
}
</style>
