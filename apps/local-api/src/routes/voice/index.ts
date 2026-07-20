// The `voice` HTTP surface — the brain's spoken output.
//
//   POST /voice/speak -> speak (a brain-surface MCP tool; rootSurface)
//
// `speak` lets ANY global session emit voice: the light voice-triage session, the
// global root answering a voice request, a scheduled task's morning briefing.
// It's `rootSurface`, so the generator emits it into `generatedRoutingMcpTools`
// (the global-root turn's in-process server) — never the normal workspace chat.
//
// Mutating (POST, a real-world side effect) but `mutatingApproved` — speaking
// aloud isn't irreversible, so it runs AUTO (no card), like `send_to_channel`.
// The daemon owns the speaker; this route relays and reports whether it landed.
//
// Locked Hono protocol: `describeRoute` from the local openapi.js wrapper,
// `validator` from `hono-openapi/zod`, chained methods on `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import { loadToolDescription } from '@vynel/instructions/tool-descriptions'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { loadEnv } from '../../env.js'
import { speakThroughDaemon } from './speak-through-daemon.js'
import { SpeakRequestSchema, SpeakResponseSchema } from './schemas.js'

export const voiceApp = factory.createApp().post(
  '/speak',
  describeRoute({
    tags: ['voice'],
    summary: "Speak text aloud through the user's voice (the Jarvis speaker).",
    'x-sdk-name': 'voice.speak',
    responses: {
      200: {
        description: "{ spoken: true } — or { spoken: false, reason } if voice output isn't available.",
        content: { 'application/json': { schema: resolver(SpeakResponseSchema) } },
      },
    },
    'x-mcp': {
      exposed: true,
      name: 'speak',
      mutatingApproved: true,
      rootSurface: true,
      // Editable markdown, the session-instructions pattern — re-run
      // `pnpm api:generate` after editing speak.md so the registry copy follows.
      description: loadToolDescription('speak'),
    },
  }),
  validator('json', SpeakRequestSchema),
  ...userScoped,
  async (c) => {
    const { text } = c.req.valid('json')
    return c.json(await speakThroughDaemon(loadEnv().VYNEL_VOICE_DAEMON_URL, text))
  },
)
