<script setup lang="ts">
import {
  PhDesktop as Desktop,
  PhDownloadSimple as DownloadSimple,
  PhFiles as Files,
  PhFilmSlate as FilmSlate,
  PhHardDrive as HardDrive,
  PhHouse as House,
  PhImage as Image,
  PhLaptop as Laptop,
  PhMusicNotes as MusicNotes,
} from "@phosphor-icons/vue";
import type {
  DriveRootResponse,
  KnownPlaceResponse,
} from "@vynel/contracts/workspaces/workspace-http";
import { driveDisplayName, isPathWithin } from "./file-system-path.js";

// Explorer's left rail: the pinned places (Home, Desktop, Documents, …) then
// "This PC" with every drive underneath. Everything here is a single-click
// jump — these are destinations, never selections.
const props = defineProps<{
  places: KnownPlaceResponse[];
  drives: DriveRootResponse[];
  /** The folder currently open, or null when the drives view ("This PC") is showing. */
  currentPath: string | null;
}>();

const emit = defineEmits<{
  openFolder: [path: string];
  openThisPc: [];
}>();

const PLACE_ICONS = {
  home: House,
  desktop: Desktop,
  documents: Files,
  downloads: DownloadSimple,
  pictures: Image,
  music: MusicNotes,
  videos: FilmSlate,
} as const;

function placeLabel(place: KnownPlaceResponse): string {
  return place.kind === "home" ? "Home" : place.name;
}

function isCurrentPlace(place: KnownPlaceResponse): boolean {
  return props.currentPath !== null && isPathWithin(props.currentPath, place.path) &&
    // Home contains everything else — only light it when it's the exact folder.
    (place.kind !== "home" || props.currentPath === place.path);
}

function isCurrentDrive(drive: DriveRootResponse): boolean {
  return props.currentPath !== null && isPathWithin(props.currentPath, drive.path);
}
</script>

<template>
  <nav class="fs-rail flex w-44 shrink-0 flex-col overflow-y-auto border-r border-hair py-1.5" aria-label="Places">
    <button
      v-for="place in props.places"
      :key="place.path"
      type="button"
      class="fs-place flex cursor-default items-center gap-2 px-3 py-[5px] text-left text-[12px] text-ink-1 outline-none transition focus-visible:bg-row-hover"
      :class="isCurrentPlace(place) ? 'bg-row-active' : 'hover:bg-row-hover'"
      :title="place.path"
      @click="emit('openFolder', place.path)"
    >
      <component :is="PLACE_ICONS[place.kind]" :size="15" weight="duotone" class="shrink-0 text-ink-2" />
      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ placeLabel(place) }}</span>
    </button>

    <div class="mx-3 my-1.5 border-t border-hair" />

    <button
      type="button"
      class="fs-this-pc flex cursor-default items-center gap-2 px-3 py-[5px] text-left text-[12px] text-ink-1 outline-none transition focus-visible:bg-row-hover"
      :class="props.currentPath === null ? 'bg-row-active' : 'hover:bg-row-hover'"
      @click="emit('openThisPc')"
    >
      <Laptop :size="15" weight="duotone" class="shrink-0 text-ink-2" />
      <span>This PC</span>
    </button>
    <button
      v-for="drive in props.drives"
      :key="drive.path"
      type="button"
      class="fs-drive-nav flex cursor-default items-center gap-2 py-[4px] pl-7 pr-3 text-left text-[11.5px] text-ink-1 outline-none transition focus-visible:bg-row-hover"
      :class="isCurrentDrive(drive) ? 'bg-row-active' : 'hover:bg-row-hover'"
      :title="drive.path"
      @click="emit('openFolder', drive.path)"
    >
      <HardDrive :size="14" weight="duotone" class="shrink-0 text-ink-2" />
      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ driveDisplayName(drive) }}</span>
    </button>
  </nav>
</template>
