import type { DemoFileNode } from "./fixtures/file-trees.js";
import { demoFileTreesByWorkspaceId } from "./fixtures/file-trees.js";

// Demo file contents with in-memory edits — the stand-in for the files API's
// read/write routes. Edits survive navigation (not reload), so the editor's
// save → reopen loop behaves like it will against the real backend.

const editedContents = new Map<string, string>();

function contentKey(workspaceId: string, filePath: string): string {
  return `${workspaceId}:${filePath}`;
}

function findNode(
  nodes: DemoFileNode[],
  segments: string[],
): DemoFileNode | null {
  const [head, ...rest] = segments;
  const node = nodes.find((row) => row.name === head);
  if (!node) return null;
  if (rest.length === 0) return node;
  return findNode(node.children ?? [], rest);
}

export function getDemoFileContent(
  workspaceId: string,
  filePath: string,
): string {
  const edited = editedContents.get(contentKey(workspaceId, filePath));
  if (edited !== undefined) return edited;

  const tree = demoFileTreesByWorkspaceId[workspaceId] ?? [];
  const node = findNode(tree, filePath.split("/"));
  return node?.content ?? "";
}

export function saveDemoFileContent(
  workspaceId: string,
  filePath: string,
  content: string,
): void {
  editedContents.set(contentKey(workspaceId, filePath), content);
}
