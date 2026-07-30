# Security boundaries

- No key is committed to the repository.
- Participant and AP keys are stored only in Apps Script Properties.
- Public endpoints are read-only.
- AP actions require an AP key and are written to an append-only audit log.
- Participant submissions require a separate packet key.
- The public snapshot is generated server-side from allowed fields.
- Browser local storage may remember a key for convenience, but it is not a
  security boundary.
- The AP console must be served with `noindex`, `no-store`, and HTTPS.
- Production write actions should add rate limits and key rotation procedures.
