# Micheal Ray Berry — Public Accountability Project

Official public record. Declared start 340 lb -> 175 lb. Administered by the
Accountability Partner. Live site: https://michealrayberry.com

The site is static at the repo root. On every Netlify deploy, `npm run build`
runs `scripts/publish.mjs`: it reads the public record sheet and regenerates
/daily, /weeks, /violations, /positions, /corner-time, /consent, /about,
/agreement, milestone pages, sitemaps, and feed.xml in place. Those generated
directories are gitignored — never commit a laptop run of `npm run generate`.
