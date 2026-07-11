/**
 * Reads a picked file into raw base64 (no data-URL prefix) — the shape the
 * hub's publish endpoint expects for `artifactBase64`. One home for the
 * FileReader promise dance shared by both publish forms.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the zip file."));
    // An aborted read fires onabort, not onerror — without this the promise
    // would hang forever.
    reader.onabort = () =>
      reject(new Error("Reading the zip file was aborted."));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
