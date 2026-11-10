/**
 * The project's public GitHub repository, linked from the landing page (Star / Fork) and its
 * footer. One place, so the links can't point at two different repositories.
 */
export const REPO_OWNER = "chiachunho";
export const REPO_NAME = "joubill";
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const REPO_FORK_URL = `${REPO_URL}/fork`;
export const REPO_ISSUES_URL = `${REPO_URL}/issues`;
export const REPO_ARCHITECTURE_URL = `${REPO_URL}/tree/dev/docs/architecture`;
export const REPO_DEPLOYMENT_URL = `${REPO_URL}/blob/dev/docs/DEPLOYMENT.md`;
export const AUTHOR_NAME = "Jeffery Ho";
export const AUTHOR_URL = `https://github.com/${REPO_OWNER}`;

/** `1234` → `1.2k`, the way GitHub abbreviates a star count. */
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.floor(n / 100) / 10;
  return `${Number.isInteger(k) ? k.toFixed(0) : k}k`;
}

/**
 * The repository's star count, or null when GitHub can't be asked. A garnish on the Star
 * button: a slow or rate-limited GitHub must never hold up the landing page, so it gives up
 * after two seconds and the button shows without a number.
 */
export async function fetchRepoStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(2000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const stars = (body as { stargazers_count?: unknown }).stargazers_count;
    return typeof stars === "number" && Number.isFinite(stars) ? stars : null;
  } catch {
    return null;
  }
}
