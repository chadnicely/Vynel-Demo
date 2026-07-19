// The SDK-free `@vynel/instructions/session-instructions` subpath — a filesystem
// loader for the always-on identity/operating prompts. Kept off the package
// barrel (`../index.ts`, which exports the notebook MCP descriptor) so a prompt
// reader like `@vynel/session` imports the loader without the SDK-builder graph.

export {
  loadSessionInstruction,
  type SessionInstructionId,
} from './load-session-instruction.js'
