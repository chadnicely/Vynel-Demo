<script setup lang="ts">
import type { AttachedImageMetadata } from "@vynel/contracts/chat/chat-http";

// The quiet "what rode along" strip on a sent message — one chip per
// attachment (name + human size). Presentational only: the row's metadata is
// references, the bytes live server-side under the session's transcripts dir.
const props = defineProps<{
  attachments: AttachedImageMetadata[];
}>();

function humanSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
</script>

<template>
  <div class="attachment-chips">
    <span
      v-for="(attachment, index) in props.attachments"
      :key="`${attachment.filename}-${index}`"
      class="chip"
    >
      <!-- Inline glyphs keep @vynel/ui icon-library-free -->
      <svg
        v-if="isImage(attachment.mimeType)"
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="2"
          y="3"
          width="12"
          height="10"
          rx="1.5"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
        <path
          d="M3 11.5l3-3 2.5 2.5 2-2 2.5 2.5"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg
        v-else
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
        <path d="M9 1.5V5.5H13" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      </svg>
      <span class="name">{{ attachment.filename }}</span>
      <span class="size">{{ humanSize(attachment.sizeBytes) }}</span>
    </span>
  </div>
</template>

<style scoped>
.attachment-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 260px;
  padding: 2px 9px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-2);
  font: 500 11px/1.6 var(--font-ui);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size {
  color: var(--ink-3);
  font-size: 10px;
}
</style>
