// File-type presentation: which color family (tokens.css --file-*) and icon
// shape a tree row gets. Pure lookup — shared by the tree and the editor
// header so a file always wears the same color everywhere.

export type FileColorFamily =
  "folder" | "doc" | "data" | "image" | "code" | "plain";

const FAMILY_BY_EXTENSION: Record<string, FileColorFamily> = {
  md: "doc",
  markdown: "doc",
  txt: "doc",
  pdf: "doc",
  csv: "data",
  json: "data",
  yaml: "data",
  yml: "data",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  ts: "code",
  tsx: "code",
  js: "code",
  vue: "code",
  css: "code",
  html: "code",
  sh: "code",
};

export function fileColorFamily(fileName: string): FileColorFamily {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return FAMILY_BY_EXTENSION[extension] ?? "plain";
}
