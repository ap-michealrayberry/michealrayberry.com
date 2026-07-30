# Architecture

## Rule 1: one authoritative daily packet

The system must make one server-side decision for each project date:

- `pending`
- `submitted`
- `accepted`
- `incomplete`
- `excused`
- `violation`

The public site, recorder, AP console, SEO publisher, and deadline automation
must read that same result. No interface independently infers a violation from a
missing file or failed network request.

## Rule 2: interfaces do one job

### Public site

Read-only. It renders a published snapshot and cannot write to the record.

### Recorder

Captures and prepares the participant's daily packet. It does not declare
violations, resolve violations, change project state, or publish AP statements.

### AP console

Reviews packets and performs AP-authorized actions. It does not contain public
site rendering or participant camera code.

### Backend

Owns validation, timestamps, packet status, violation status, audit events, and
public snapshot generation.

## Rule 3: generated output is separate from source

Editable source lives in this directory. Generated public day pages, resized
media, manifests, and sitemaps must be written to a separate generated
directory or deployment artifact.

## Rule 4: irreversible actions need durable evidence

A missing CSV response, timeout, expired token, or failed API request is an
operational fault, not proof of noncompliance. Deadline automation must record
the evidence it checked and require multiple successful reads before creating a
violation.
