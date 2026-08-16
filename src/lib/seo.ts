import { SITE_NAME } from "@/data/record";

export const SITE_ORIGIN = "https://michealrayberry.com";

export function pageHead({
  title,
  description,
  path,
  noindex = false,
  image = "/og-image.png",
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  image?: string;
}) {
  const url = `${SITE_ORIGIN}${path}`;
  const fullTitle = title.includes("Micheal") ? title : `${title} — ${SITE_NAME}`;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      {
        name: "robots",
        content: noindex
          ? "noindex,nofollow"
          : "index,follow,max-image-preview:large,max-snippet:-1",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: `${SITE_ORIGIN}${image}` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: fullTitle },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: `${SITE_ORIGIN}${image}` },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
