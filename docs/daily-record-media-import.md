# Daily public record and media import

## Scope

Migration `0006_import-daily-media` creates a normalized public daily-media inventory and imports the media references currently present in the `Weigh-ins` tab.

Imported coverage:

- July 20–30, 2026: four public photo references and one inspection-video reference per day.
- July 31, 2026: weight record retained with all five media components explicitly reported as missing.
- Total imported media references: 55.
- Complete media days: 11.
- Incomplete media days: 1.

The source spreadsheet is read only. The migration preserves source-system and source-row traceability.

## Public API

`GET /api/public/daily-records` returns:

- project day and date
- public weight and note
- front, left, rear, and right photo references
- inspection-video reference
- per-day photo and video counts
- a completeness flag
- an explicit missing-component list

The endpoint supports `GET`, `HEAD`, stable ETags, and conditional `304 Not Modified` responses.

## Important classification boundary

Media completeness is a factual inventory result. It is not itself a violation determination. The API does not assign consequences, interpret amendments, or expose financial amounts. July 31 remains visibly incomplete, but violation publication stays blocked until the signed amendment numbering conflict is reconciled.

## Privacy boundary

This import excludes private evidence, Drive credentials, access tokens, signed-document contents, consequence amounts, Appendix A details, and unpublished administrative notes. Only URLs already recorded as public project media references are imported.

## Production verification

Run:

```sh
npm run verify:daily-records
```

The verifier expects 12 weighted daily records, 11 complete media days, one incomplete media day, 55 media references, five missing components on July 31, and working conditional requests.

## Rollback

Application rollback can remove the API route without deleting imported records. Database rollback, when formally approved, should drop `public_record.daily_public_records` and `public_record.daily_media` only after exporting the source-traceability fields. The Google Sheet remains unchanged as the historical source during parallel operation.
