<script setup lang="ts">
import { PhCheck } from "@phosphor-icons/vue";
import { CALLOUT } from "./wizard-classes.js";

// Screen 11 — Security & Protection, Built In. The static promise grid:
// twelve things considered automatically as the software is built, ending on
// "You don't need to be a security expert."
const CARE = [
  {
    label: "Secure Authentication",
    body: "Secure sign-in, password protection, sessions, and account recovery.",
  },
  {
    label: "Database Security",
    body: "Protected database access, permissions, and safeguards against unauthorized access.",
  },
  {
    label: "Data Isolation",
    body: "Each customer only has access to the data they're supposed to see.",
  },
  {
    label: "Encryption",
    body: "Secure HTTPS connections and protection for sensitive information.",
  },
  {
    label: "API Key & Secret Protection",
    body: "API keys, database credentials, payment keys, and other secrets are kept out of public-facing code.",
  },
  {
    label: "Payment Security",
    body: "Payments are routed through secure payment providers without storing sensitive card information in your software.",
  },
  {
    label: "Roles & Permissions",
    body: "Admins, team members, customers, and other users receive the appropriate level of access.",
  },
  {
    label: "Secure File Storage",
    body: "Uploads and private files are protected with appropriate access controls.",
  },
  {
    label: "Backups & Recovery",
    body: "Your data can be backed up and recovered when supported by your infrastructure.",
  },
  {
    label: "Security Checks Before Launch",
    body: "We check for exposed credentials, insecure permissions, authentication issues, and other common vulnerabilities.",
  },
  {
    label: "Monitoring & Error Logging",
    body: "Your software is structured so errors and important system activity can be tracked.",
  },
  {
    label: "Data Ownership & Portability",
    body: "Your code. Your data. Your software. You remain in control.",
  },
];
</script>

<template>
  <div class="grid gap-2.5 sm:grid-cols-2">
    <div
      v-for="entry in CARE"
      :key="entry.label"
      class="flex items-start gap-2.5"
    >
      <PhCheck :size="14" class="mt-0.5 shrink-0 text-gold" weight="bold" />
      <span class="grid gap-0.5">
        <span class="text-[12.5px] text-ink-1">{{ entry.label }}</span>
        <span class="text-[11.5px] leading-relaxed text-ink-3">{{
          entry.body
        }}</span>
      </span>
    </div>
  </div>

  <div :class="CALLOUT" class="grid gap-1">
    <span class="text-[13.5px] text-ink-1"
      >You don't need to be a security expert.</span
    >
    <span class="text-[12px] leading-relaxed text-ink-2">
      These protections are considered automatically as we build your software.
      When your project requires additional protection, we'll account for that
      too.
    </span>
  </div>
</template>
