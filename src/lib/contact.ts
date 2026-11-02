/**
 * The address people write to about their data or these terms, shown on the privacy policy
 * and terms pages (`/help/privacy`, `/help/terms`). Optional: unset, the pages say so instead
 * of printing a placeholder. Read on the server; the help pages are prerendered, so a change
 * takes effect at the next deploy.
 */
export function contactEmail(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.CONTACT_EMAIL?.trim();
  return value ? value : null;
}
