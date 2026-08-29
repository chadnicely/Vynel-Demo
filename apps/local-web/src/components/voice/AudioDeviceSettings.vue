<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { PhMicrophone as Microphone, PhSpeakerHigh as SpeakerHigh } from "@phosphor-icons/vue";
import { useAudioDevices } from "../../composables/voice/use-audio-devices.js";
import { useMicrophoneLevel } from "../../composables/voice/use-microphone-level.js";

// Settings → Voice → Devices: WHICH microphone hears and WHICH speaker answers.
//
// The pick is saved as the device's NAME, never its browser id — ids are
// origin-scoped and rotate whenever the mic permission is reset, so a saved id
// would silently stop matching. "" is the clear, back to the system default.
//
// This screen ASKS for the microphone on open rather than hiding the request
// behind a link: a browser withholds every device NAME until a page has held
// mic permission once, so without it both pickers read "System default" and
// nothing else — a device picker that cannot name a device.

const props = defineProps<{
  inputName: string | null;
  outputName: string | null;
  saving: boolean;
}>();

const emit = defineEmits<{
  save: [patch: { voiceInputDeviceName?: string; voiceOutputDeviceName?: string }];
  test: [deviceId: string | undefined];
}>();

const devices = useAudioDevices();

const chosenInputId = computed(
  () => devices.inputs.find((device) => device.name === props.inputName)?.deviceId,
);
const chosenOutputId = computed(
  () => devices.outputs.find((device) => device.name === props.outputName)?.deviceId,
);

// The soundwaves: proof by ear-and-eye that the picked microphone is hearing
// the room, rather than trust in a dropdown (Chad, 2026-08-28).
const meter = useMicrophoneLevel(chosenInputId);
const BARS = 9;
/** Each bar lights in turn as loudness climbs, with the middle bars tallest so
 *  a quiet room still reads as a shape rather than a flat line. */
const bars = computed(() =>
  Array.from({ length: BARS }, (_, index) => {
    const distance = Math.abs(index - (BARS - 1) / 2) / ((BARS - 1) / 2);
    const reach = 1 - distance * 0.55;
    return Math.max(0.12, Math.min(1, meter.level.value * reach * 1.6));
  }),
);

/** A saved name whose device is not plugged in right now still shows — marked
 *  — rather than reading as "System default", which would look like it never
 *  saved. */
const missingInput = computed(
  () =>
    props.inputName !== null && !devices.inputs.some((d) => d.name === props.inputName),
);
const missingOutput = computed(
  () =>
    props.outputName !== null && !devices.outputs.some((d) => d.name === props.outputName),
);

// The first enumeration is ASYNC, so at mount `labelsHidden` is still its
// initial false — deciding then meant never asking, and a picker that only
// ever offered "System default" however the browser's own permission read.
// Await the real answer, and treat an EMPTY list as needing permission too:
// a page that has never held the mic gets entries with blank labels, which we
// drop, so "no names" and "no devices" arrive looking identical.
async function reload(): Promise<void> {
  await devices.revealLabels();
  await devices.refresh();
}

onMounted(async () => {
  // Unconditional on purpose. Deciding from `labelsHidden` meant reading it
  // before the first async enumeration had resolved, so the answer was always
  // "names are fine" and the picker never filled. Asking outright costs
  // nothing when permission is already granted — no prompt is shown.
  await devices.revealLabels();
  await devices.refresh();
});

// Opening the meter's stream is itself a permission grant — the names the
// browser was withholding exist from that moment, so re-read the list.
watch(
  () => meter.live.value,
  (live) => {
    if (live) void devices.refresh();
  },
);
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="devices.unsupported" class="m-0 text-xs text-ink-3">
      This browser cannot list audio devices — Vynel uses the system default microphone and
      speaker.
    </p>

    <template v-else>
      <label class="flex items-center gap-2 text-xs text-ink-2">
        <Microphone :size="14" />
        <span class="w-16 shrink-0">Microphone</span>
        <select
          class="min-w-0 flex-1 rounded-sm border border-hair bg-chrome px-2 py-1 text-ink-1"
          :disabled="props.saving"
          :value="props.inputName ?? ''"
          @change="emit('save', {
            voiceInputDeviceName: ($event.target as HTMLSelectElement).value,
          })"
        >
          <option value="">System default</option>
          <option v-for="device in devices.inputs" :key="device.deviceId" :value="device.name">
            {{ device.name }}
          </option>
          <option v-if="missingInput" :value="props.inputName ?? ''">
            {{ props.inputName }} (not connected)
          </option>
        </select>

        <!-- Live level: it moves when the picked mic hears you. -->
        <span
          class="level flex h-5 shrink-0 items-center gap-[2px]"
          :data-live="meter.live.value"
          :title="meter.live.value ? 'Hearing you' : 'Not hearing anything yet'"
        >
          <i v-for="(height, index) in bars" :key="index" :style="{ transform: `scaleY(${height})` }" />
        </span>
      </label>

      <p v-if="devices.inputs.length === 0" class="m-0 pl-[88px] text-xs text-ink-3">
        No microphones to choose from — the browser returned {{ devices.seen }} audio device(s)
        and {{ devices.labelsHidden ? "is withholding their names" : "none were usable" }}.
        <button type="button" class="underline" @click="reload()">Try again</button>
      </p>

      <p v-if="meter.error.value !== null" class="m-0 pl-[88px] text-xs text-ink-3">
        {{ meter.error.value }}
        <button type="button" class="underline" @click="devices.revealLabels()">Try again</button>
      </p>

      <label class="flex items-center gap-2 text-xs text-ink-2">
        <SpeakerHigh :size="14" />
        <span class="w-16 shrink-0">Speaker</span>
        <select
          class="min-w-0 flex-1 rounded-sm border border-hair bg-chrome px-2 py-1 text-ink-1"
          :disabled="props.saving"
          :value="props.outputName ?? ''"
          @change="emit('save', {
            voiceOutputDeviceName: ($event.target as HTMLSelectElement).value,
          })"
        >
          <option value="">System default</option>
          <option v-for="device in devices.outputs" :key="device.deviceId" :value="device.name">
            {{ device.name }}
          </option>
          <option v-if="missingOutput" :value="props.outputName ?? ''">
            {{ props.outputName }} (not connected)
          </option>
        </select>
        <button
          type="button"
          class="shrink-0 rounded-sm border border-hair px-2 py-1 text-ink-2 hover:text-ink-1"
          @click="emit('test', chosenOutputId)"
        >
          Test
        </button>
      </label>

      <!-- Said plainly rather than hidden: the browser's own speech recognition
           exposes no device knob, so the microphone pick cannot bind it. -->
      <p class="m-0 text-xs text-ink-3">
        The microphone applies to the wake word and to cloud hearing. Web speech recognition
        always uses your system default microphone — the browser offers no way to choose.
      </p>
    </template>
  </div>
</template>

<style scoped>
.level i {
  display: block;
  width: 3px;
  height: 100%;
  border-radius: 1px;
  background: var(--ink-3);
  transform-origin: center;
  transition: transform 70ms linear;
}

.level[data-live="true"] i {
  background: var(--color-accent);
}
</style>
