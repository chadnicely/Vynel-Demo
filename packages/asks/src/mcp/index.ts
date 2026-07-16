// The `@vynel/asks/mcp` subpath — the SDK-touching half of the asks leaf.
// Turn streams dynamic-import this (keeping the agent-SDK builder out of
// route-module load); everything SDK-free stays on the main barrel.

export {
  buildAskFeatureDescriptor,
  ASK_PROMPT_INSTRUCTIONS,
} from './ask-mcp-feature-descriptor.js'
