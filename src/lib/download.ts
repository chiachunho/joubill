/**
 * Save a file response in the browser, under the name the server put in
 * `Content-Disposition` (both exports name the file after the group).
 * Client-only; shared by the CSV and beancount downloads.
 */
export async function saveResponseAsFile(res: Response, fallbackName: string): Promise<void> {
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in Safari; give it a moment to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
