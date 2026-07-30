# Daily packet data contract

```json
{
  "date": "YYYY-MM-DD",
  "projectDay": 1,
  "weightLb": 340.0,
  "video": {
    "url": "https://...",
    "sha256": "..."
  },
  "photos": {
    "front": {"url": "https://...", "sha256": "..."},
    "left": {"url": "https://...", "sha256": "..."},
    "rear": {"url": "https://...", "sha256": "..."},
    "right": {"url": "https://...", "sha256": "..."}
  },
  "submittedAt": "ISO-8601 server timestamp",
  "status": "accepted",
  "review": {
    "reviewedAt": "ISO-8601 server timestamp",
    "reviewedBy": "AP",
    "notes": ""
  }
}
```

## Public fields

The public snapshot may expose:

- date and project day
- weight
- accepted/incomplete/violation/excused status
- published media URLs
- violation date, nature, and resolved/unresolved status
- official public updates

It must not expose private keys, internal notes, consequence amounts, private
session links, credential inventories, or raw audit payloads.
