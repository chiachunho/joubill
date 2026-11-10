import { Api } from "grammy";

import { Landing } from "@/components/landing/Landing";
import { botUsername } from "@/lib/bot-username";
import { addToGroupLink } from "@/lib/deep-link";
import { fetchRepoStars } from "@/lib/github-repo";
import { HELP_PATH } from "@/lib/help-url";
import { jsonLdString, siteOrigin, softwareApplicationJsonLd } from "@/lib/seo";

// Rebuilt at most hourly: the bot's username and the star count change rarely, and neither
// is worth a request to Telegram or GitHub on every visit.
export const revalidate = 3600;

/**
 * Telegram's "add to group" link for the bot. A bare grammY `Api` rather than `getBot()`, so the
 * landing page doesn't pull in the bot's commands and `@/db` (which needs every server env var).
 * Without a token or a reachable Telegram (a CI build) the button points at the help site.
 */
async function addToGroupHref(): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const username = token ? await botUsername(new Api(token)) : null;
  return username ? addToGroupLink(username) : HELP_PATH;
}

export default async function Home() {
  const [href, stars] = await Promise.all([addToGroupHref(), fetchRepoStars()]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(softwareApplicationJsonLd(siteOrigin())) }}
      />
      <Landing addToGroupHref={href} stars={stars} />
    </>
  );
}
