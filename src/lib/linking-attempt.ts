import { isLoginProvider, type LoginProvider } from "@/lib/identities";

/**
 * The provider a person is linking from the settings page, kept for the trip through the
 * OAuth provider. Auth.js's error redirect doesn't say which provider failed, so the settings
 * page reads it back here to name it in the message (issue #105). Both ends live in this
 * file, since a key that drifts between them fails silently into the unnamed wording.
 */
const KEY = "splitbill:linking";

export function rememberLinking(provider: LoginProvider): void {
  try {
    sessionStorage.setItem(KEY, provider);
  } catch {
    // Storage can be unavailable (private mode); the message just won't name the provider.
  }
}

/** The remembered attempt, without forgetting it (safe to call while rendering). */
export function peekLinking(): LoginProvider | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && isLoginProvider(value) ? value : null;
  } catch {
    return null;
  }
}

/** Forgets the attempt, so a later, unrelated error can't be blamed on it. */
export function forgetLinking(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to forget
  }
}
