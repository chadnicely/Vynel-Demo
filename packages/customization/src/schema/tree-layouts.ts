// `tree_layouts` — one row per user: where they dragged each group and each
// workspace in the sidebar tree, as ONE JSON value (group ids top-to-bottom,
// workspace ids per list). A drop writes the whole displayed sequence, so
// what the user sees is exactly what sticks; membership (which group) stays
// on the workspace row in the kernel — this is position only.

import { table, id, json, timestamp, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import type { TreeLayoutResponse } from '@vynel/contracts/customization/customization-http'

export type TreeLayout = TreeLayoutResponse

export const treeLayouts = table(
  'tree_layouts',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    layout: json<TreeLayout>().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (row) => [uniqueIndex('tree_layouts_user_unique').on(row.userId)],
)

export type TreeLayoutRow = typeof treeLayouts.$inferSelect
export type NewTreeLayoutRow = typeof treeLayouts.$inferInsert
