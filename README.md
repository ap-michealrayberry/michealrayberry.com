# Micheal Ray Berry Public Accountability Project — Rebuild v2

This directory is an isolated replacement architecture. It does not modify or
depend on the legacy site's custom `x-dc` runtime.

## Three interfaces

- `public-site/` — read-only public record.
- `recorder/` — participant-only daily packet capture and preparation.
- `ap-console/` — AP-only review and administration.
- `backend/` — version-controlled Google Apps Script API scaffold.

## Important

The sample project values were imported from the legacy repository
(July 20, 2026; 340 lb; 175 lb) only to make the prototype render. Verify all
contract values against the signed agreement before activation.

## Local preview

Serve this directory over HTTP; do not open the HTML files directly.

```bash
python3 -m http.server 8080 --directory .
```

Then open:

- Public site: `http://localhost:8080/public-site/`
- Recorder: `http://localhost:8080/recorder/`
- AP console: `http://localhost:8080/ap-console/`

## Deployment approach

1. Keep the legacy production site live.
2. Put this directory on a separate branch.
3. Deploy each interface to a staging URL.
4. Import the Apps Script backend after reviewing secrets and Sheet IDs.
5. Test one complete daily packet end to end.
6. Only then switch production routing.
