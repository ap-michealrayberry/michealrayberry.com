// Presentation-only normalization shared by all generated record pages.
export function polishHtml(html, file) {
  if (!file.endsWith('.html')) return html;
  let output = html.replace(/(href|content)="(https:\/\/michealrayberry\.com)?\/(dashboard|uniform|updates|milestones|agreement|about)(?=["#])/g,
    '$1="$2/$3/');
  output = output.replace(/(href|content)="(https:\/\/michealrayberry\.com)?\/penalties\/?(?=["#])/g, '$1="$2/violations/');
  output = output.replace(/micheal-ray-berry-official-front\.jpg/g, 'micheal-ray-berry-official-front-v2.jpg');
  if (!output.includes('href="/public.css"')) output = output.replace('</head>', '<link rel="stylesheet" href="/public.css">\n</head>');
  if (/<main(?:\s|>)/.test(output) && !output.includes('class="skip-link"')) {
    output = output.replace(/<main(?![^>]*\bid=)/, '<main id="main-content"');
    const target = output.match(/<main[^>]*\bid="([^"]+)"/)?.[1];
    if (target) output = output.replace(/(<body[^>]*>)/, '$1\n<a class="skip-link" href="#' + target + '">Skip to main content</a>');
  }
  output = output.replace(/<nav(?![^>]*aria-label)/g, '<nav aria-label="Site navigation"');
  output = output.replace(/<th(?![^>]*scope)(?=[ >])/g, '<th scope="col"');
  output = output.replace(/<iframe(?![^>]*\btitle=)/g, '<iframe title="Project recording"');
  return output;
}
