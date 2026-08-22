<script setup lang="ts">
// Settings → Desktop control (Kafi, 2026-08-22: "get the desktop control under
// a menu on Settings, from the env, so the user can enable it from there").
//
// ONE toggle, and it governs ACTING only. Looking was never gated and this
// screen says so plainly — the trust here comes from the copy being true:
// acting is off until you turn it on, every act is written to the desktop
// actions log, and under the default mode Vynel does not ask each time.
//
// The engine resolves this preference on EVERY turn, so a flip lands on the
// next turn with no restart — hence the "next turn", not "immediately".

import { computed } from "vue";
import { PhMonitor as Monitor } from "@phosphor-icons/vue";
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from "../../composables/users/use-user-preferences.js";
import SectionHeader from "./SectionHeader.vue";

const preferencesQuery = useUserPreferences();
const updatePreferences = useUpdateUserPreferences();

const preferences = computed(() => preferencesQuery.data.value ?? null);
const acting = computed(() => preferences.value?.desktopActionsEnabled === true);

function setActing(enabled: boolean) {
  updatePreferences.mutate({ desktopActionsEnabled: enabled });
}
</script>

<template>
  <section class="desktop-control-section flex flex-col gap-3">
    <SectionHeader
      title="Desktop control"
      subtitle="What Vynel is allowed to do on this computer"
      :icon="Monitor"
    />

    <p v-if="preferencesQuery.isError.value" class="apply-note m-0 text-xs text-danger" role="alert">
      Could not load your settings. Try again in a moment.
    </p>
    <p v-else-if="preferencesQuery.isPending.value" class="m-0 text-xs text-ink-3">Checking…</p>

    <template v-else>
      <div class="rounded-xl border border-hair bg-raised px-3.5 py-2.5">
        <label class="acting-toggle flex items-start gap-2.5 text-xs text-ink-1">
          <input
            type="checkbox"
            class="mt-0.5 accent-[var(--gold)]"
            :checked="acting"
            :disabled="updatePreferences.isPending.value"
            @change="setActing(($event.target as HTMLInputElement).checked)"
          />
          <span>
            Let Vynel act on your desktop (click, type, press keys)
            <span class="mt-1 block text-ink-3">
              Vynel can already look at your screen — take screenshots, see which windows are
              open. This is only about letting it touch things.
            </span>
          </span>
        </label>
      </div>

      <p class="acting-state m-0 text-xs text-ink-2">
        <template v-if="acting">
          Right now: Vynel can look at your desktop <strong>and act on it</strong>.
        </template>
        <template v-else>
          Right now: Vynel can look at your desktop, but <strong>not act on it</strong>.
        </template>
      </p>

      <p class="next-turn-note m-0 text-xs text-ink-3">
        A change here takes effect from the next turn — whatever Vynel is doing right now carries
        on as it started.
      </p>

      <div class="honest-copy flex flex-col gap-1.5 text-xs text-ink-3">
        <p class="m-0">
          Looking is always allowed — screenshots and the list of open windows are how Vynel
          answers questions about what is on your screen.
        </p>
        <p class="m-0">Acting is off until you turn it on.</p>
        <p class="m-0">Every action Vynel takes is recorded in Vynel's desktop actions log.</p>
        <p class="m-0">
          Under the default mode, Vynel acts without asking you each time — so turn this on only
          when you want it working on your desktop on its own.
        </p>
      </div>

      <p v-if="updatePreferences.isError.value" class="m-0 text-xs text-danger" role="alert">
        Could not save that. Your setting is unchanged.
      </p>
    </template>
  </section>
</template>
