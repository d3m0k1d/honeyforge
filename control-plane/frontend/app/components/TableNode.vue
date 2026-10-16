<script setup lang="ts">
import type { TableSchema } from "~/types/database";

const props = defineProps<{ table: TableSchema }>();

const store = useTablesStore();
const dragging = ref(false);

const isSelected = computed(() => store.selectedTableId === props.table.id);

let frame: number | null = null;
let pendingMove: { x: number; y: number } | null = null;

function onPointerDown(event: PointerEvent) {
  if ((event.target as HTMLElement).closest("button")) return;

  const startX = event.clientX;
  const startY = event.clientY;
  const originX = props.table.x;
  const originY = props.table.y;

  function onMove(moveEvent: PointerEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragging.value = true;

    pendingMove = { x: originX + dx, y: originY + dy };

    if (frame !== null) return;

    frame = requestAnimationFrame(() => {
      frame = null;

      if (!pendingMove) return;

      store.moveTable(props.table.id, pendingMove.x, pendingMove.y);
      pendingMove = null;
    });
  }

  function onUp() {
    dragging.value = false;

    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }

    if (pendingMove) {
      store.moveTable(props.table.id, pendingMove.x, pendingMove.y);
      pendingMove = null;
    }

    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}
</script>

<template>
  <div
    class="absolute select-none rounded-md border bg-default shadow-md"
    :class="[
      dragging ? 'cursor-grabbing shadow-xl' : '',
      isSelected ? 'ring-1' : '',
    ]"
    :style="{
      left: `${table.x}px`,
      top: `${table.y}px`,
      width: `${NODE_WIDTH}px`,
      borderColor: table.color,
      '--tw-ring-color': table.color,
    }"
    data-radial-ignore
    @click="store.selectTable(table.id)"
  >
    <div
      class="flex cursor-grab items-center gap-2 rounded-t-md px-3"
      :style="{
        height: `${NODE_HEADER_HEIGHT}px`,
        background: `${table.color}14`,
        borderBottom: `1px solid ${table.color}66`,
      }"
      @pointerdown="onPointerDown"
    >
      <UIcon name="i-lucide-grip-vertical" class="size-4 text-dimmed" />
      <span
        class="flex-1 truncate font-mono text-sm font-semibold text-highlighted"
      >
        {{ table.name }}
      </span>
      <div class="flex items-center">
        <UButton
          icon="i-lucide-pencil"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Изменить"
          @click.stop="store.openEditModal(table.id)"
        />
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          aria-label="Удалить"
          @click.stop="store.requestDelete(table.id)"
        />
      </div>
    </div>

    <div class="py-1">
      <div
        v-for="column in table.columns"
        :key="column.id"
        class="flex items-center gap-2 px-3"
        :style="{ height: `${ROW_HEIGHT}px` }"
      >
        <UIcon
          :name="columnIcon(column)"
          class="size-3.5 shrink-0"
          :style="{ color: column.primaryKey ? table.color : undefined }"
          :class="column.primaryKey ? '' : 'text-dimmed'"
        />
        <span class="flex-1 truncate text-xs text-toned">
          {{ column.name || "—" }}
        </span>
        <span class="font-mono text-[10px] text-dimmed">
          {{ formatColumnType(column) }}
        </span>
      </div>
    </div>
  </div>
</template>
