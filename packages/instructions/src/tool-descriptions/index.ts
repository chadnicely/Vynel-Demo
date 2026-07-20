// The SDK-free `@vynel/instructions/tool-descriptions` subpath — a filesystem
// loader for model-facing tool descriptions. Kept off the package barrel for
// the same reason as `./session-instructions`: a route that only needs the
// description STRING must not pull the notebook MCP descriptor's SDK graph.

export {
  loadToolDescription,
  type ToolDescriptionId,
} from './load-tool-description.js'
