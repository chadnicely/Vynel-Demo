<script setup lang="ts">
import { computed } from "vue";
import {
  PhDisc as Disc,
  PhGlobe as Globe,
  PhHardDrive as HardDrive,
  PhUsb as Usb,
} from "@phosphor-icons/vue";
import type { DriveRootResponse } from "@vynel/contracts/workspaces/workspace-http";
import { driveDisplayName, formatBytesLikeExplorer } from "./file-system-path.js";

// A "This PC" drive card — Explorer's Devices-and-drives tile: name, a
// capacity bar, "51.2 GB free of 399 GB". A drive is a place to go, not a
// thing to pick, so a single click opens it.
const props = defineProps<{
  drive: DriveRootResponse;
}>();

const emit = defineEmits<{
  open: [];
}>();

const DRIVE_ICONS = {
  fixed: HardDrive,
  removable: Usb,
  network: Globe,
  optical: Disc,
  unknown: HardDrive,
} as const;

const name = computed(() => driveDisplayName(props.drive));
const hasCapacity = computed(
  () =>
    props.drive.freeBytes !== null &&
    props.drive.totalBytes !== null &&
    props.drive.totalBytes > 0,
);
const usedFraction = computed(() =>
  hasCapacity.value
    ? 1 - props.drive.freeBytes! / props.drive.totalBytes!
    : 0,
);
const capacityText = computed(() =>
  hasCapacity.value
    ? `${formatBytesLikeExplorer(props.drive.freeBytes!)} free of ${formatBytesLikeExplorer(props.drive.totalBytes!)}`
    : "",
);
</script>

<template>
  <button
    type="button"
    class="fs-drive flex w-full cursor-default items-center gap-3 rounded-sm px-2.5 py-2 text-left outline-none transition hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-gold"
    :title="props.drive.path"
    @click="emit('open')"
  >
    <component :is="DRIVE_ICONS[props.drive.kind]" :size="34" weight="duotone" class="shrink-0 text-ink-2" />
    <span class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-ink-1">
        {{ name }}
      </span>
      <span
        v-if="hasCapacity"
        class="block h-[9px] w-full overflow-hidden rounded-[2px] border border-hair-strong bg-inset"
      >
        <span
          class="block h-full"
          :class="usedFraction > 0.9 ? 'bg-danger' : 'bg-info'"
          :style="{ width: `${Math.round(usedFraction * 100)}%` }"
        />
      </span>
      <span class="min-h-[13px] text-[10.5px] text-ink-3">{{ capacityText }}</span>
    </span>
  </button>
</template>
