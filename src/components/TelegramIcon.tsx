/**
 * Telegram's logo. lucide has no brand icons, so it lives here, shared by the login button
 * (the coloured badge) and the settings rows (the plain glyph, which takes `currentColor` so an
 * `IconTile` tints it like every other row and a Telegram theme can recolour it).
 */
export function TelegramLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2CA5E0" />
      <path
        d="M5.5 11.5L17 7l-3 10-2.5-3.5L9 15l-.5-3L5.5 11.5z"
        fill="white"
        stroke="white"
        strokeWidth="0.3"
        strokeLinejoin="round"
      />
      <path d="M9 15l1.5-1 1 2.5" fill="white" />
    </svg>
  );
}

/** The paper plane alone, in the current text colour. */
export function TelegramGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.6 3.3 2.9 10.5c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.4-1.5ZM9.4 14l8.9-5.6c.4-.3.8-.1.5.2l-7.6 6.9-.3 3.2L9.4 14Z" />
    </svg>
  );
}
