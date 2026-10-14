<script setup lang="ts">
const store = useTablesStore();

const canvasSize = computed(() => {
  let width = 720;
  let height = 520;

  for (const table of store.tables) {
    width = Math.max(width, table.x + NODE_WIDTH + 140);
    height = Math.max(height, table.y + nodeHeight(table) + 140);
  }

  return { width, height };
});

const paths = computed(() =>
  store.relations
    .map((relation) => {
      const from = store.getTable(relation.fromTableId);
      const to = store.getTable(relation.toTableId);

      if (!from || !to) return null;

      const forward = to.x >= from.x;
      const fromX = forward ? from.x + NODE_WIDTH : from.x;
      const toX = forward ? to.x : to.x + NODE_WIDTH;
      const fromY = columnAnchorY(from, relation.fromColumnId);
      const toY = columnAnchorY(to, relation.toColumnId);
      const midX = (fromX + toX) / 2;

      return {
        id: relation.id,
        path: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
        colorIndex: Math.max(0, TABLE_COLORS.indexOf(relation.color)),
      };
    })
    .filter((path): path is NonNullable<typeof path> => path !== null),
);
</script>

<template>
  <div class="relative h-[calc(100vh-16rem)] overflow-auto rounded-lg border border-default bg-default/60">
    <div
      class="relative"
      :style="{
        width: `${canvasSize.width}px`,
        height: `${canvasSize.height}px`,
        backgroundImage:
          'radial-gradient(circle, rgba(148, 163, 184, 0.14) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }"
    >
      <svg
        class="pointer-events-none absolute inset-0"
        :width="canvasSize.width"
        :height="canvasSize.height"
      >
        <defs>
          <marker
            v-for="(color, index) in TABLE_COLORS"
            :id="`schema-arrow-${index}`"
            :key="index"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" :fill="color" />
          </marker>
        </defs>

        <path
          v-for="path in paths"
          :key="path.id"
          :d="path.path"
          fill="none"
          :stroke="TABLE_COLORS[path.colorIndex]"
          stroke-width="1.6"
          :marker-end="`url(#schema-arrow-${path.colorIndex})`"
          opacity="0.7"
        />
      </svg>

      <TableNode
        v-for="table in store.tables"
        :key="table.id"
        :table="table"
      />

      <div
        v-if="!store.tables.length"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
      >
        <UIcon name="i-lucide-database" class="size-10 text-dimmed" />
        <div>
          <p class="text-sm font-medium text-toned">Схема пуста</p>
          <p class="text-xs text-muted">
            Создайте таблицу в сайдбаре, чтобы начать
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
