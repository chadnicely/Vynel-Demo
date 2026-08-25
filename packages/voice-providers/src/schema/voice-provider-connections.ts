// `voice_provider_connections` — one row per (user, provider): the user's
// own ElevenLabs / Google Cloud account, connected with an API key for
// cloud TTS/STT. Machine-level like the voice picks themselves, so no
// workspace scope.
//
// `encryptedCredentials` is a SEALED AES-256-GCM blob (the ssh-servers
// precedent) against the keyring-held master key — NEVER returned by any
// route, NEVER logged. It is opened only inside the engine-side
// synthesize/transcribe/list-voices paths (`credentials/
// open-voice-provider-credentials.ts`). Rotation = reconnect with a new
// key (the connect op upserts).

import { table, id, text, timestamp, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'

export const voiceProviderConnections = table(
  'voice_provider_connections',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    provider: text().$type<VoiceProviderId>().notNull(),
    encryptedCredentials: text().notNull(), // sealed blob — never returned, never logged
    accountLabel: text(), // display-only (e.g. the ElevenLabs subscription tier); null when the provider offers none
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userProviderIdx: uniqueIndex('idx_voice_provider_connections_user_provider').on(
      t.userId,
      t.provider,
    ),
  }),
)

export type VoiceProviderConnection = typeof voiceProviderConnections.$inferSelect
export type NewVoiceProviderConnection = typeof voiceProviderConnections.$inferInsert
