// Public surface of `@vynel/workspaces/mcp` — the `#workspace` study
// descriptor (chat-mentions). A SEPARATE subpath (the ssh-servers precedent)
// so the main `@vynel/workspaces` barrel stays free of the SDK builder import;
// the api streams dynamically import this half only when a turn carries refs.

export {
  buildWorkspaceStudyDescriptor,
  type StudyWorkspace,
} from './workspace-study-descriptor.js'
