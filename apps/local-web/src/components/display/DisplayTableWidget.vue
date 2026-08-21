<script setup lang="ts">
import { computed } from "vue";
import {
  DISPLAY_TABLE_MAX_COLUMNS,
  type TableWidgetContent,
} from "@vynel/contracts/display/display-widget-content";

// Rows and columns, data-only — every cell is text the browser never
// interprets, so there is nothing here to sanitize.
const props = defineProps<{ content: TableWidgetContent }>();

// The contract caps columns at the boundary; the renderer caps again because
// a row PERSISTED under an older cap would otherwise draw a table too wide to
// read. Cells are trimmed to the columns actually drawn so no row runs past
// its header.
const columns = computed(() => props.content.columns.slice(0, DISPLAY_TABLE_MAX_COLUMNS));
const rows = computed(() =>
  props.content.rows.map((row) => row.slice(0, columns.value.length)),
);
</script>

<template>
  <div class="display-table" data-testid="display-widget-table">
    <!-- Its OWN scroller: a wide table must never push the room sideways. -->
    <table>
      <caption v-if="props.content.caption">{{ props.content.caption }}</caption>
      <thead>
        <tr>
          <th v-for="column in columns" :key="column" scope="col">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
          <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.display-table {
  overflow: auto;
  max-width: 100%;
}

/* Type comes from `.display-root` — the room is monospace, and a table is
   where that pays: columns line up on their own. */
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 10px;
  line-height: 1.7;
}

caption {
  padding-bottom: 4px;
  text-align: left;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

th,
td {
  padding: 2px 8px 2px 0;
  text-align: left;
  white-space: nowrap;
}

th {
  position: sticky;
  top: 0;
  background: rgba(3, 14, 26, 0.92);
  border-bottom: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 400;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

td {
  color: var(--display-text, #cdf3ff);
}

tbody tr:nth-child(even) td {
  background: rgba(79, 216, 255, 0.04);
}
</style>
