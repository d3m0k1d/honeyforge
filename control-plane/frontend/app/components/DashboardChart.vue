<script setup lang="ts">
import type {
  Chart as ChartInstance,
  ChartData,
  ChartOptions,
  ChartType,
} from "chart.js";

const props = withDefaults(
  defineProps<{
    type: ChartType;
    data: ChartData;
    options?: ChartOptions;
    height?: number;
    animate?: boolean;
  }>(),
  {
    options: undefined,
    height: 220,
    animate: false,
  },
);

const canvas = ref<HTMLCanvasElement | null>(null);
let chart: ChartInstance | null = null;

async function render() {
  if (!canvas.value) return;

  const { Chart } = await import("~/utils/chart");

  chart?.destroy();
  chart = new Chart(canvas.value, {
    type: props.type,
    data: props.data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...props.options,
    },
  });
}

watch(
  () => props.data,
  (data) => {
    if (!chart) return;

    chart.data = data;
    chart.update(props.animate ? undefined : "none");
  },
);

onMounted(render);
onBeforeUnmount(() => {
  chart?.destroy();
  chart = null;
});
</script>

<template>
  <div :style="{ height: `${height}px` }" class="relative">
    <canvas ref="canvas" />
  </div>
</template>
