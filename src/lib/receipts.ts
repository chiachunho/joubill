/** Resolve receipt file IDs with lazy migration fallback to the legacy single-column. */
export function resolveReceiptFileIds(
  fileIds: string[],
  legacyFileId: string | null | undefined,
): string[] {
  return fileIds.length > 0 ? fileIds : legacyFileId ? [legacyFileId] : [];
}
