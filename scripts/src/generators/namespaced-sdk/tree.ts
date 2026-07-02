// Build the nested-namespace tree from a flat list of ParsedOperation.
// Detects collisions where a leaf method and an internal namespace
// would share the same dotted path (e.g. annotating both
// `knowledge.search` and `knowledge.search.foo`).

import { type NamespaceNode, type ParsedOperation, makeNode } from './types.js'

export function buildTree(operations: ParsedOperation[]): NamespaceNode {
  const root = makeNode()
  for (const op of operations) {
    const segments = op.sdkName.split('.')
    let node = root
    for (let i = 0; i < segments.length - 1; i++) {
      // safe: i < segments.length, so segments[i] is present.
      const segment = segments[i]!
      let child = node.children.get(segment)
      if (!child) {
        child = makeNode()
        node.children.set(segment, child)
      }
      if (child.operation) {
        // A leaf collided with an internal namespace.
        throw new Error(
          `[sdk:generate-namespaced] namespace collision at "${segments
            .slice(0, i + 1)
            .join('.')}" — used as both a method and an internal namespace.`,
        )
      }
      node = child
    }
    // safe: validateSdkName guarantees ≥2 segments, so the last exists.
    const leafName = segments[segments.length - 1]!
    if (node.children.has(leafName)) {
      throw new Error(
        `[sdk:generate-namespaced] namespace collision at "${op.sdkName}" — ` +
          `used as both a method and an internal namespace.`,
      )
    }
    const leaf = makeNode()
    leaf.operation = op
    node.children.set(leafName, leaf)
  }
  return root
}
