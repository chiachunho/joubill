"use client";

import { useEffect, useRef } from "react";

/**
 * Embeds the Telegram Login Widget button. The widget script must be appended
 * to the DOM via a ref rather than next/script because Telegram's script
 * inserts the button immediately before itself at load time — Next.js's script
 * optimisation moves tags to the body, which breaks the placement.
 */
export function TelegramLoginWidget({
  botUsername,
  callbackUrl,
}: {
  botUsername: string;
  callbackUrl: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-auth-url", callbackUrl);
    script.setAttribute("data-request-access", "write");
    script.async = true;
    ref.current.appendChild(script);
  }, [botUsername, callbackUrl]);

  return <div ref={ref} />;
}
