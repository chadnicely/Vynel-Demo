// The cloud voice-provider HTTP surface — USER-scoped, mounted at `/voice`
// beside the daemon-relay voice routes:
//
//   GET    /voice/providers                    -> catalog + connection state
//   POST   /voice/providers/:provider/connect  -> connect (the key's ONLY door)
//   DELETE /voice/providers/:provider          -> disconnect (hard delete)
//   GET    /voice/providers/:provider/voices   -> the provider's voices (live)
//   POST   /voice/transcribe                   -> cloud STT: WAV in, transcript out
//   POST   /voice/provider-synthesize          -> cloud TTS: text in, WAV out
//
// NO x-mcp anywhere — connecting an account and changing whose voice speaks
// are the user's doors (the models/reload stance). The key goes in ONCE
// through connect, is sealed by the leaf, and no response carries it back
// (serializers.ts is the stripping boundary).
//
// transcribe/provider-synthesize are the EXECUTING doors: the browser's
// cloud-STT leg and the daemon's relay engines both land here, so the
// opened key lives only in this process for the length of one outbound
// call. Both read the user's saved source pick — they refuse (409) when
// the pick isn't provider-backed rather than letting a caller choose a
// provider ad hoc.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` →
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses.

import { resolver, validator } from 'hono-openapi/zod'
import { ConflictError, ValidationError } from '@vynel/errors'
import {
  getVoiceProviderCatalogEntry,
  VOICE_PROVIDER_IDS,
  type VoiceProviderId,
} from '@vynel/contracts/voice/voice-providers'
import {
  connectVoiceProvider,
  createVoiceProviderAdapter,
  disconnectVoiceProvider,
  listVoiceProviderConnectionsForUser,
  openVoiceProviderCredentials,
} from '@vynel/voice-providers'
// Subpath imports on purpose: the voice-engine BARREL eagerly loads the
// sherpa native addon, which this engine process neither needs nor (when
// packaged) carries — the cloud modules are pure.
import {
  createProviderSpeechRecognizer,
  createProviderVoiceEngine,
} from '@vynel/voice-engine/provider-engines'
import { decodeWavToPcm, encodeWavFromPcm } from '@vynel/voice-engine/pcm-codec'
import { VoiceProviderRequestError } from '@vynel/voice-engine/voice-provider-request-error'
import { getUserPreferences } from '@vynel/core/users'
import { factory } from '../../../factory.js'
import { describeRoute } from '../../../openapi.js'
import { userScoped } from '../../../handler-bundles/user-scoped.js'
import { requireSealingMasterKey } from '../../../sealing-master-key.js'
import { serializeVoiceProviderStatus } from './serializers.js'
import {
  ConnectVoiceProviderRequestSchema,
  ListVoiceProvidersResponseSchema,
  ProviderSynthesizeRequestSchema,
  TranscribeResponseSchema,
  VoiceProviderParamSchema,
  VoiceProviderStatusSchema,
  VoiceProviderVoicesResponseSchema,
} from './schemas.js'

// One fault vocabulary for both executing doors: an auth failure means the
// stored key died (reconnect); anything else is the provider being
// unreachable — a state this engine can't fix, hence 409 (the closed-
// taxonomy stance from `sealing-master-key.ts`).
function rethrowProviderFault(error: unknown, provider: VoiceProviderId): never {
  if (error instanceof VoiceProviderRequestError) {
    const label = getVoiceProviderCatalogEntry(provider).label
    if (error.isAuthFailure) {
      throw new ValidationError(
        `${label} rejected the stored API key — reconnect it in Settings → Voice.`,
      )
    }
    throw new ConflictError(`${label} is unavailable right now (${error.message}). Try again.`)
  }
  throw error
}

export const voiceProvidersApp = factory
  .createApp()
  // GET /providers — every catalog provider with this user's connection state.
  .get(
    '/providers',
    describeRoute({
      tags: ['voice'],
      summary: 'List the cloud voice providers and whether each is connected.',
      'x-sdk-name': 'voiceProviders.list',
      responses: {
        200: {
          description: 'Catalog + connection state per provider (never credentials).',
          content: { 'application/json': { schema: resolver(ListVoiceProvidersResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const connections = listVoiceProviderConnectionsForUser(c.var.db, c.var.user.id)
      return c.json(
        VOICE_PROVIDER_IDS.map((provider) =>
          serializeVoiceProviderStatus(
            getVoiceProviderCatalogEntry(provider),
            connections.find((connection) => connection.provider === provider) ?? null,
          ),
        ),
      )
    },
  )
  // POST /providers/:provider/connect — verify over the network, seal, upsert.
  .post(
    '/providers/:provider/connect',
    describeRoute({
      tags: ['voice'],
      summary: 'Connect a cloud voice provider with an API key (sealed, never returned).',
      'x-sdk-name': 'voiceProviders.connect',
      responses: {
        200: {
          description: 'Connected — the provider status (no credentials).',
          content: { 'application/json': { schema: resolver(VoiceProviderStatusSchema) } },
        },
        400: { description: 'The provider rejected the API key.' },
        409: { description: 'The sealing key is unavailable.' },
      },
    }),
    validator('param', VoiceProviderParamSchema),
    validator('json', ConnectVoiceProviderRequestSchema),
    ...userScoped,
    async (c) => {
      const masterKeyBase64 = requireSealingMasterKey(c, 'Connecting a voice provider')
      const { provider } = c.req.valid('param')
      const connection = await connectVoiceProvider(
        c.var.db,
        {
          userId: c.var.user.id,
          provider,
          credentials: { apiKey: c.req.valid('json').apiKey },
        },
        {
          masterKeyBase64,
          adapter: createVoiceProviderAdapter(provider, c.var.voiceProviderFetch),
          logger: c.var.logger,
        },
      )
      return c.json(serializeVoiceProviderStatus(getVoiceProviderCatalogEntry(provider), connection))
    },
  )
  // DELETE /providers/:provider — hard delete; the sealed key dies with the row.
  .delete(
    '/providers/:provider',
    describeRoute({
      tags: ['voice'],
      summary: 'Disconnect a cloud voice provider (hard delete of the sealed key).',
      'x-sdk-name': 'voiceProviders.disconnect',
      responses: {
        204: { description: 'Disconnected.' },
        404: { description: 'This provider is not connected.' },
      },
    }),
    validator('param', VoiceProviderParamSchema),
    ...userScoped,
    (c) => {
      disconnectVoiceProvider(
        c.var.db,
        { userId: c.var.user.id, provider: c.req.valid('param').provider },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
  // GET /providers/:provider/voices — the live voice list for the picker.
  .get(
    '/providers/:provider/voices',
    describeRoute({
      tags: ['voice'],
      summary: "List a connected provider's voices for the Settings picker.",
      'x-sdk-name': 'voiceProviders.listVoices',
      responses: {
        200: {
          description: '{ voices } — id, label, language per voice.',
          content: { 'application/json': { schema: resolver(VoiceProviderVoicesResponseSchema) } },
        },
        400: { description: 'The provider rejected the stored key — reconnect.' },
        409: { description: 'This provider is not connected, or the sealing key is unavailable.' },
      },
    }),
    validator('param', VoiceProviderParamSchema),
    ...userScoped,
    async (c) => {
      const masterKeyBase64 = requireSealingMasterKey(c, 'Listing provider voices')
      const { provider } = c.req.valid('param')
      const credentials = openVoiceProviderCredentials(
        c.var.db,
        { userId: c.var.user.id, provider },
        { masterKeyBase64 },
      )
      if (credentials === null) {
        throw new ConflictError(
          `${getVoiceProviderCatalogEntry(provider).label} is not connected — connect it in Settings → Voice first.`,
        )
      }
      const adapter = createVoiceProviderAdapter(provider, c.var.voiceProviderFetch)
      return c.json({ voices: await adapter.listVoices({ credentials }) })
    },
  )
  // POST /transcribe — the cloud-STT executing door (browser leg + daemon relay).
  .post(
    '/transcribe',
    describeRoute({
      tags: ['voice'],
      summary: 'Transcribe one spoken utterance (mono 16-bit WAV body) through the selected cloud provider.',
      'x-sdk-name': 'voiceProviders.transcribe',
      responses: {
        200: {
          description: '{ text } — the transcript (empty when nothing was said).',
          content: { 'application/json': { schema: resolver(TranscribeResponseSchema) } },
        },
        400: { description: 'Bad audio body, or the provider rejected the stored key.' },
        409: {
          description:
            'Cloud transcription is not the selected hearing source, the provider is not connected, or it is unreachable.',
        },
      },
    }),
    ...userScoped,
    async (c) => {
      const masterKeyBase64 = requireSealingMasterKey(c, 'Cloud transcription')
      const preferences = getUserPreferences(c.var.db, c.var.user.id)
      const source = preferences.voiceSttSource
      if (source === 'web-speech' || source === 'local') {
        throw new ConflictError(
          'Cloud transcription is not the selected hearing source — pick a provider in Settings → Voice.',
        )
      }
      const credentials = openVoiceProviderCredentials(
        c.var.db,
        { userId: c.var.user.id, provider: source },
        { masterKeyBase64 },
      )
      if (credentials === null) {
        throw new ConflictError(
          `${getVoiceProviderCatalogEntry(source).label} is selected for hearing but not connected — connect it in Settings → Voice.`,
        )
      }
      const audioBytes = new Uint8Array(await c.req.arrayBuffer())
      if (audioBytes.byteLength === 0) {
        throw new ValidationError('The request body must be the utterance as mono 16-bit WAV.')
      }
      let pcm
      try {
        pcm = decodeWavToPcm(audioBytes)
      } catch (error) {
        throw new ValidationError(
          `The audio body is not decodable WAV: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const recognizer = createProviderSpeechRecognizer({
        provider: source,
        apiKey: credentials.apiKey,
        fetchImplementation: c.var.voiceProviderFetch,
      })
      try {
        return c.json({ text: await recognizer.transcribe(pcm) })
      } catch (error) {
        rethrowProviderFault(error, source)
      }
    },
  )
  // POST /provider-synthesize — the cloud-TTS executing door (the daemon's
  // relay engine fetches WAV here; its own /synthesize keeps serving the
  // browser unchanged).
  .post(
    '/provider-synthesize',
    describeRoute({
      tags: ['voice'],
      summary: 'Synthesize text through the selected cloud provider — answers mono 16-bit WAV.',
      'x-sdk-name': 'voiceProviders.synthesize',
      responses: {
        200: { description: 'The spoken audio as audio/wav (mono 16-bit PCM).' },
        400: { description: 'Validation error, or the provider rejected the stored key.' },
        409: {
          description:
            'Cloud speaking is not the selected source, no provider voice is picked, the provider is not connected, or it is unreachable.',
        },
      },
    }),
    validator('json', ProviderSynthesizeRequestSchema),
    ...userScoped,
    async (c) => {
      const masterKeyBase64 = requireSealingMasterKey(c, 'Cloud speech')
      const preferences = getUserPreferences(c.var.db, c.var.user.id)
      const source = preferences.voiceTtsSource
      if (source === 'local') {
        throw new ConflictError(
          'Cloud speaking is not the selected source — pick a provider in Settings → Voice.',
        )
      }
      if (preferences.voiceTtsProviderVoiceId === null) {
        throw new ConflictError(
          `No ${getVoiceProviderCatalogEntry(source).label} voice is picked — choose one in Settings → Voice.`,
        )
      }
      const credentials = openVoiceProviderCredentials(
        c.var.db,
        { userId: c.var.user.id, provider: source },
        { masterKeyBase64 },
      )
      if (credentials === null) {
        throw new ConflictError(
          `${getVoiceProviderCatalogEntry(source).label} is selected for speaking but not connected — connect it in Settings → Voice.`,
        )
      }
      const engine = createProviderVoiceEngine({
        provider: source,
        apiKey: credentials.apiKey,
        providerVoiceId: preferences.voiceTtsProviderVoiceId,
        fetchImplementation: c.var.voiceProviderFetch,
      })
      try {
        const pcm = await engine.synthesize(c.req.valid('json').text)
        return c.body(encodeWavFromPcm(pcm), 200, { 'content-type': 'audio/wav' })
      } catch (error) {
        rethrowProviderFault(error, source)
      }
    },
  )
