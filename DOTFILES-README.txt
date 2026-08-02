HIDDEN FILES IN THIS FOLDER — do not skip them
==============================================

Three items begin with a dot or underscore and are easy to miss. All three
must reach the repository root, or parts of the site silently stop working.

  .github/workflows/publish.yml   nightly daily-page publisher (GitHub Actions)
  _headers                        Netlify security + caching headers
  _redirects                      Netlify URL routing (/ap, /record, 301s)

macOS Finder and Windows Explorer hide dotfiles by default:
  macOS    — press Cmd + Shift + . in Finder to show them
  Windows  — View > Show > Hidden items

The GitHub web uploader (drag-and-drop) IGNORES folders beginning with a dot.
To add the workflow through the website instead:

  1. In the repo, click  Add file > Create new file
  2. Type this exact path in the filename box:
        .github/workflows/publish.yml
     (typing the slashes creates the folders)
  3. Paste the contents of publish-workflow.yml from this folder
  4. Commit

Then: Settings > Actions > General > Workflow permissions > Read and write.

_headers and _redirects upload normally by drag-and-drop; just confirm they
are present in the repo root afterwards.
