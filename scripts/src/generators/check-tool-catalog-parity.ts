// CI parity guard for the tool-catalog snapshot in `@vynel/contracts`.
// Re-runs the generator + diffs against the checked-in
// `catalog-snapshot.ts` — the same snapshot/restore pattern as
// `check-mcp-parity.ts`. Non-zero exit on drift.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const checkedInPath = path.join(
  repoRoot,
  "packages",
  "contracts",
  "src",
  "generated",
  "tool-catalog-snapshot.ts",
);

let committedContent: string;
try {
  committedContent = readFileSync(checkedInPath, "utf8");
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(
    `[tool-catalog:parity] missing ${path.relative(repoRoot, checkedInPath)}; ` +
      `run \`pnpm api:generate\` to emit it. (${(err as Error).message})`,
  );
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
}

const result = spawnSync(
  "tsx",
  [
    path.join(
      repoRoot,
      "scripts",
      "src",
      "generators",
      "generate-tool-catalog.ts",
    ),
  ],
  { stdio: "inherit", shell: true },
);
if (result.status !== 0) {
  writeFileSync(checkedInPath, committedContent);
  // eslint-disable-next-line n/no-process-exit
  process.exit(result.status ?? 1);
}

const regenerated = readFileSync(checkedInPath, "utf8");
writeFileSync(checkedInPath, committedContent);

if (regenerated !== committedContent) {
  // eslint-disable-next-line no-console
  console.error(
    `[tool-catalog:parity] drift detected — ` +
      `\`packages/contracts/src/generated/tool-catalog-snapshot.ts\` does NOT match ` +
      `what the generator would emit. Run \`pnpm api:generate\` and commit the result.`,
  );
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log("[tool-catalog:parity] ok — snapshot matches the committed file.");
