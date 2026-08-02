FILES THAT ARE EASY TO MISS — do not skip them
==============================================

Everything in this folder uploads by drag-and-drop, but two files begin with
an underscore and one with a dot, so confirm they are present in the repo
root after uploading:

  netlify.toml   builds the daily record pages on every deploy
  _headers       security + caching headers
  _redirects     URL routing (/ap, /record, 301s)

macOS Finder and Windows Explorer hide dot-prefixed files by default:
  macOS    — press Cmd + Shift + . in Finder to show them
  Windows  — View > Show > Hidden items

There is no .github folder and no GitHub Actions setup. Netlify runs the
publisher itself, using netlify.toml. Nothing else to configure.

After the first deploy, check Netlify > Deploys > (latest) > Deploy log for
the line "Finalized records published: N".
