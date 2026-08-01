import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { AdminApiError } from "../../lib/admin-api.js";
import { readFileAsBase64 } from "../../lib/read-file-base64.js";
import {
  usePublishCatalogVersion,
  type PublishCatalogVersionInput,
} from "./use-publish-catalog-version.js";
import { usePublishFromRepo } from "./use-publish-from-repo.js";
import type { InspectRepoResponse } from "./use-inspect-repo.js";
import type { CatalogPublisherOption } from "./use-catalog-publishers.js";

type ItemKind = PublishCatalogVersionInput["item"]["kind"];
// '' stands in for null in the scope <select> (options can't carry null).
type ScopeOption = "" | "user" | "workspace" | "both";

const MANIFEST_PREFILLS: Record<ItemKind, string> = {
  skill: '{"kind":"skill","entryFile":"SKILL.md"}',
  agent: '{"kind":"agent","entryFile":"agent.json"}',
  mcp: "{}",
  rule: "{}",
  plugin: "{}",
};

/** The publish form's whole state machine — both artifact sources (zip
 *  upload / GitHub repo), the inspect prefill, and the submit dispatch. The
 *  view stays layout-only. */
export function usePublishItemForm(options: {
  /** Routes the publisher block of an inspected vynel-item.json to the
   *  PublisherPicker (a component instance the view owns). */
  onPublisherPrefill: (
    prefill: NonNullable<NonNullable<InspectRepoResponse["manifest"]>["publisher"]>,
  ) => void;
}) {
  const router = useRouter();
  const publishMutation = usePublishCatalogVersion();
  const repoMutation = usePublishFromRepo();

  // Where the artifact comes from: a picked zip, or a GitHub repo folder
  // the hub clones at a pinned sha.
  const sourceMode = ref<"zip" | "repo">("zip");
  const repoUrl = ref("");
  const repoRef = ref("");
  const repoSubpath = ref("");

  const form = reactive({
    itemId: "",
    kind: "skill" as ItemKind,
    displayName: "",
    oneLineDescription: "",
    category: "",
    iconName: "",
    // Credit line: where the content comes from ('' = first-party, no
    // link). Repo publishes derive `<repo>/tree/<sha>/<folder>` server-side
    // when left empty.
    sourceUrl: "",
    recommendedScope: "user" as ScopeOption,
    minimumTier: "basic" as "basic" | "pro",
    status: "draft" as "draft" | "published",
    version: "",
    changelog: "",
  });

  const publisher = ref<CatalogPublisherOption | null>(null);

  const manifestText = ref(MANIFEST_PREFILLS[form.kind]);
  // Once the admin touches the manifest it's theirs — switching kind must
  // not clobber hand-written JSON, only untouched prefills.
  const manifestEdited = ref(false);
  watch(
    () => form.kind,
    (kind) => {
      if (!manifestEdited.value) manifestText.value = MANIFEST_PREFILLS[kind];
    },
  );

  const zipFile = ref<File | null>(null);
  const localError = ref<string | null>(null);

  const isPending = computed(
    () => publishMutation.isPending.value || repoMutation.isPending.value,
  );

  const errorMessage = computed(() => {
    if (localError.value !== null) return localError.value;
    const error = publishMutation.error.value ?? repoMutation.error.value;
    if (error === null) return null;
    // 409 = the version already exists, 400 = schema rejection — the hub's
    // message says exactly which; surface it verbatim.
    return error instanceof AdminApiError
      ? error.message
      : "Publishing failed — try again.";
  });

  function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    zipFile.value = input.files?.[0] ?? null;
  }

  // Inspect prefills only what it knows, and only over still-empty fields —
  // the admin's typed values win. The exception is sourceUrl: every inspect
  // is a fresh pin, so the credit link always follows the newest sha.
  function applyInspectPrefill(result: InspectRepoResponse) {
    const item = result.manifest?.item ?? {};
    const version = result.manifest?.version ?? {};
    const kind = item.kind ?? result.detectedKind;
    if (kind !== null && kind !== undefined) form.kind = kind;
    if (form.itemId === "" && item.itemId !== undefined) form.itemId = item.itemId;
    if (form.displayName === "" && item.displayName !== undefined)
      form.displayName = item.displayName;
    if (form.oneLineDescription === "" && item.oneLineDescription !== undefined)
      form.oneLineDescription = item.oneLineDescription;
    if (form.category === "" && item.category !== undefined)
      form.category = item.category;
    if (form.iconName === "" && item.iconName !== undefined)
      form.iconName = item.iconName;
    if (item.recommendedScope !== undefined)
      form.recommendedScope = item.recommendedScope ?? "";
    if (item.minimumTier !== undefined) form.minimumTier = item.minimumTier;
    if (item.status !== undefined) form.status = item.status;
    form.sourceUrl = item.sourceUrl ?? result.sourceUrl;
    if (form.version === "" && version.version !== undefined)
      form.version = version.version;
    if (form.changelog === "" && version.changelog !== undefined)
      form.changelog = version.changelog;
    if (!manifestEdited.value && version.manifest !== undefined) {
      manifestText.value = JSON.stringify(version.manifest);
      manifestEdited.value = true;
    }
    if (result.manifest?.publisher !== undefined) {
      options.onPublisherPrefill(result.manifest.publisher);
    }
  }

  function parseManifest(): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(manifestText.value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to the shared error below.
    }
    return null;
  }

  function publishBodyBase(
    manifest: Record<string, unknown>,
    picked: CatalogPublisherOption,
  ) {
    return {
      publisher: picked,
      item: {
        itemId: form.itemId,
        kind: form.kind,
        displayName: form.displayName,
        oneLineDescription: form.oneLineDescription,
        category: form.category,
        iconName: form.iconName,
        sourceUrl: form.sourceUrl.trim() === "" ? null : form.sourceUrl.trim(),
        recommendedScope:
          form.recommendedScope === "" ? null : form.recommendedScope,
        minimumTier: form.minimumTier,
        status: form.status,
      },
      version: {
        version: form.version,
        changelog: form.changelog,
        manifest,
        minAppVersion: null,
      },
    };
  }

  const goToPublished = (published: { itemId: string }) =>
    void router.push({ name: "catalog-item", params: { itemId: published.itemId } });

  async function handleSubmit() {
    localError.value = null;
    const manifest = parseManifest();
    if (manifest === null) {
      localError.value = "The manifest must be a JSON object.";
      return;
    }
    if (form.category === "") {
      localError.value = "Pick a category first.";
      return;
    }
    if (form.iconName === "") {
      localError.value = "Pick an icon first.";
      return;
    }
    if (publisher.value === null) {
      localError.value =
        "Pick a publisher (or fill in the new publisher's id and name).";
      return;
    }
    const base = publishBodyBase(manifest, publisher.value);

    if (sourceMode.value === "repo") {
      if (repoUrl.value.trim() === "") {
        localError.value = "Enter the GitHub repo URL first.";
        return;
      }
      repoMutation.mutate(
        {
          ...base,
          repo: {
            url: repoUrl.value.trim(),
            ...(repoRef.value.trim() !== "" ? { ref: repoRef.value.trim() } : {}),
            ...(repoSubpath.value.trim() !== ""
              ? { subpath: repoSubpath.value.trim() }
              : {}),
          },
        },
        { onSuccess: goToPublished },
      );
      return;
    }

    if (zipFile.value === null) {
      localError.value = "Pick the artifact zip first.";
      return;
    }
    let artifactBase64: string;
    try {
      artifactBase64 = await readFileAsBase64(zipFile.value);
    } catch (error) {
      localError.value =
        error instanceof Error ? error.message : "Could not read the zip file.";
      return;
    }
    publishMutation.mutate({ ...base, artifactBase64 }, { onSuccess: goToPublished });
  }

  return {
    sourceMode,
    repoUrl,
    repoRef,
    repoSubpath,
    form,
    publisher,
    manifestText,
    manifestEdited,
    isPending,
    errorMessage,
    handleFileChange,
    applyInspectPrefill,
    handleSubmit,
  };
}
