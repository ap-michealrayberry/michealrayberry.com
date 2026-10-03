// Shared public navigation and layout. Operational Assistant pages keep their
// own protected workflow; public record pages share these five sections.
const SECTIONS = [
  ['Record', '/daily/', ['/', '/daily/', '/weeks/', '/violations/', '/updates/', '/testing/']],
  ['Live', '/live/', ['/live/']],
  ['Progress', '/dashboard/', ['/dashboard/', '/milestones/']],
  ['Rules', '/agreement/', ['/agreement/', '/uniform/', '/positions/', '/corrections/', '/consent/', '/verify/']],
  ['Participate', '/accountable/', ['/accountable/', '/observer/', '/notify/', '/share/', '/partner/', '/about/']],
];
export function publicNavigation(current = '') {
  const items = SECTIONS.map(([label, href, paths]) => {
    const selected = paths.some(p => p === '/' ? current === '/' : current === p || current.startsWith(p));
    const aria = selected ? ` aria-current="${current === href ? 'page' : 'true'}"` : '';
    return `<a href="${href}"${aria}${label === 'Live' ? ' data-live-nav' : ''}>${label === 'Live' ? '<span data-live-dot aria-hidden="true"></span><span data-live-label>Live</span>' : label}</a>`;
  }).join('');
  return `<nav class="sitenav" aria-label="Site navigation"><span class="nav-primary">${items}</span></nav>`;
}
export const PUBLIC_DIRECTORY = `<nav class="site-directory" aria-label="More project pages">
  <div><b>Read the record</b><a href="/daily/">Daily documentation</a><a href="/weeks/">Weekly summaries</a><a href="/violations/">Violation log</a><a href="/updates/">Updates</a><a href="/testing/">Public test archive</a></div>
  <div><b>Understand the rules</b><a href="/agreement/">Agreement and status</a><a href="/uniform/">Uniform</a><a href="/positions/">Inspection standard</a><a href="/corrections/">Corrective sessions</a><a href="/consent/">Participation evidence</a></div>
  <div><b>Follow and participate</b><a href="/live/">Watch live</a><a href="/notify/">Get updates</a><a href="/observer/">Report an issue</a><a href="/accountable/">Hold me accountable</a><a href="/share/">Share the project</a><a href="/partner/">Local Partner role</a></div>
  <div><b>About the project</b><a href="/about/">Why this is public</a><a href="/dashboard/">Progress</a><a href="/milestones/">Milestones</a><a href="/verify/">Compare a published file</a><a href="/feed.xml">RSS feed</a></div>
</nav>`;
export const PUBLIC_DESIGN_CSS = `
  .sitenav .nav-primary{display:flex;gap:4px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
  .sitenav a{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:8px 11px;font:600 13px/1.2 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.03em;color:#141412;text-decoration:none}
  .sitenav a[aria-current]{color:#b3261e;text-decoration:underline;text-underline-offset:5px}
  [data-live-dot]{width:8px;height:8px;border:1.5px solid currentColor;border-radius:50%;display:inline-block;flex-shrink:0}
  a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,[tabindex="0"]:focus-visible{outline:3px solid #b3261e;outline-offset:4px}
  .site-directory{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:28px;padding:28px 0;border-top:1px solid #3a3935;color:#fafaf7;max-width:1160px;margin:0 auto}
  .site-directory div{display:flex;flex-direction:column;gap:9px;min-width:0}
  .site-directory b{font:600 12px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:#ff6b61;letter-spacing:.04em}
  .site-directory a{font:14px/1.4 'IBM Plex Sans',system-ui,sans-serif;color:#fafaf7;text-decoration:none;overflow-wrap:anywhere}
  .home-wrap{max-width:1160px;margin:auto}
  .home-section{padding:36px 32px;border-bottom:1px solid #d8d6cf}
  .home-hero{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:40px;align-items:start}
  .home-eyebrow{font:600 12px/1.5 'IBM Plex Mono',ui-monospace,monospace;color:#b3261e;letter-spacing:.12em;text-transform:uppercase;margin:0 0 12px}
  .home-title{font-family:'IBM Plex Sans Condensed',sans-serif;font-size:clamp(32px,5vw,64px);line-height:1.04;font-weight:700;margin:0 0 14px}
  .home-lede{font-size:19px;line-height:1.65;max-width:690px;margin:0 0 18px}
  .home-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
  .home-button{display:inline-flex;align-items:center;min-height:44px;padding:11px 16px;border:1px solid #141412;font:600 14px/1.3 'IBM Plex Sans',system-ui,sans-serif;text-decoration:none}
  .home-button.primary{background:#141412;color:#fafaf7}
  .home-portrait{margin:0;display:flex;flex-direction:column;gap:10px}
  .home-portrait img{width:100%;height:auto;aspect-ratio:3/4;object-fit:cover;object-position:top;border:1px solid #141412}
  .home-portrait figcaption,.home-note{font-size:13px;line-height:1.6;color:#6b6a64;margin:0}
  .home-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #141412;margin-top:26px}
  .home-stat{padding:16px;border-right:1px solid #d8d6cf;min-width:0;display:flex;flex-direction:column;gap:7px}
  .home-stat:last-child{border-right:0}.home-stat strong{font:600 28px/1.2 'IBM Plex Mono',ui-monospace,monospace}
  .home-label{font:600 12px/1.5 'IBM Plex Mono',ui-monospace,monospace;color:#6b6a64}
  .home-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:18px}
  .home-card{border:1px solid #141412;background:#fff;padding:22px;min-width:0;display:flex;flex-direction:column;gap:14px}
  .home-card h2,.home-section h2{font-family:'IBM Plex Sans Condensed',sans-serif;font-size:26px;line-height:1.2;margin:0 0 10px}
  .home-card h2{font-size:22px;margin:0}.home-card p{margin:0;font-size:16px;line-height:1.6}
  .home-state{font-size:20px;font-weight:600;line-height:1.35;color:#141412}.home-state.good{color:#285a33}.home-state.attention{color:#b3261e}
  .home-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .home-checks li{display:flex;justify-content:space-between;gap:14px;font-size:14px;line-height:1.5;border-bottom:1px solid #edebe4;padding-bottom:6px}
  .home-checks span:last-child{font-weight:600;white-space:nowrap}
  .home-card>a:last-child{margin-top:auto;font-weight:600;min-height:30px}
  .home-progress{height:10px;background:#e5e3dc;position:relative;margin:12px 0}
  .home-progress span{display:block;height:100%;background:#285a33}
  .home-intro{max-width:780px;font-size:18px;line-height:1.7}.home-intro blockquote{margin:18px 0;padding-left:20px;border-left:3px solid #b3261e}
  .home-intro iframe{width:100%;aspect-ratio:16/9;border:0;margin:16px 0}
  .home-update{font-size:13px;line-height:1.6;color:#6b6a64;margin-top:18px}
  @media(max-width:760px){.sitenav{width:100%;overflow:visible!important;align-items:flex-start!important}.sitenav .nav-primary{flex-wrap:wrap!important;min-width:0!important;width:100%!important;justify-content:flex-start!important}.sitenav a{font-size:12px;padding:8px}.site-directory{width:100%;max-width:100%;align-items:start!important}}
  @media(max-width:700px){.home-section{padding:28px 16px}.home-hero{grid-template-columns:1fr;gap:22px}.home-title{font-size:36px}.home-lede{font-size:17px}.home-portrait{display:grid;grid-template-columns:90px 1fr;align-items:center;gap:16px}.home-portrait img{max-width:90px}.home-stats{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:22px}.home-stat:nth-child(2){border-right:0}.home-stat:nth-child(-n+2){border-bottom:1px solid #d8d6cf}.home-stat strong{font-size:24px}.home-card{padding:18px}}
  @media(max-width:380px){h1{overflow-wrap:anywhere}}
  @media(prefers-reduced-motion:reduce){[data-live-dot],.lamp,.rec-lamp{animation:none!important}}
`;
export function finishPublicHtml(html, current) {
  if (current.startsWith('/assistant/')) return html;
  let out = html.replace(/<nav\b(?=[^>]*aria-label="Site navigation")[^>]*>[\s\S]*?<\/nav>/g, publicNavigation(current));
  out = out.replace('</head>', `<style data-public-design>${PUBLIC_DESIGN_CSS}</style>\n</head>`);
  if (!out.includes('class="site-directory"')) {
    if (out.includes('<div class="sitefoot-bottom">')) out = out.replace('<div class="sitefoot-bottom">', `${PUBLIC_DIRECTORY}<div class="sitefoot-bottom">`);
    else if (out.includes('</footer>')) out = out.replace('</footer>', `${PUBLIC_DIRECTORY}</footer>`);
  }
  return out;
}
