/* Session state: sequence timing, start/stop/finish decisions, and the
   three-warning invalidation rule. Pure — no DOM, no timers of its own. */

export function seqTotal(segments) {
  return segments.reduce((t, s) => t + s.dur, 0);
}

// Which segment is active at `elapsed` seconds into the take.
export function segmentIndexAt(segments, elapsed) {
  let idx = 0, acc = 0;
  for (let i = 0; i < segments.length; i++) {
    if (elapsed >= acc) idx = i;
    acc += segments[i].dur;
  }
  return idx;
}

// Seconds remaining in the segment that is active at `elapsed`.
export function segmentRemaining(segments, angleIdx, elapsed) {
  let s = 0;
  for (let i = 0; i < angleIdx; i++) s += segments[i].dur;
  return Math.max(0, Math.ceil(s + segments[angleIdx].dur - elapsed));
}

/* One continuous take: a recording stopped before the full guided sequence is
   not an inspection and must not be delivered. (The safety stop is always
   available; using it simply means the take is discarded and restarted.) */
export function finishDecision(durMs, totalSec) {
  if (durMs < (totalSec - 1) * 1000) {
    return { accept: false, reason: 'stopped at ' + (durMs / 1000).toFixed(1) + 's of ' + totalSec + 's' };
  }
  return { accept: true };
}

// Guards mirrored from the UI handlers, centralised so they can be tested.
export function busy(s) {
  return !!(s.recording || s.countdownSec > 0);
}
export function busyOrPosing(s) {
  return busy(s) || !!s.photoPhase;
}

/* The intro line carries the day, date, and weight, so it is assembled at
   record time rather than written into the static script.
   The verification code is burned into the frame, not spoken: it is
   evidence for the AP, not narration, and reading four digits aloud
   in every recording adds nothing a viewer can use. */
export function buildIntroLine({ dayNum, spokenDate, weightSpoken }) {
  return 'This is the official Daily Inspection for Micheal Ray Berry, Day ' + dayNum + ' of the Public Accountability Project. Today is ' + spokenDate + '.' +
    (weightSpoken ? ' Documented weight this morning: ' + weightSpoken + ' pounds.' : '') +
    ' Stand at attention facing the camera. Feet together, hands behind the head, eyes forward. You do not speak during this recording. The voice speaks for the record.' +
    ' This is one continuous take. Four views are required, and the verification code shown on screen was issued moments ago by the record itself, so this footage cannot be older than it claims. Beginning with the front view. Hold the position.';
}

// "335", not "335 point zero".
export function spokenWeight(w) {
  return isNaN(w) ? '' : (w % 1 === 0 ? String(Math.round(w)) : w.toFixed(1));
}

// Day arithmetic shared by the overlay, the narration, and the filed records.
export function dayInfo(now, startDate) {
  const rawDay = Math.floor((now - new Date(startDate + 'T00:00:00')) / 864e5) + 1;
  const preStart = rawDay < 1;
  const dayNum = Math.max(1, rawDay);
  return {
    rawDay,
    preStart,
    dayNum,
    dayLabel: preStart ? 'PRE-START' : 'DAY ' + dayNum,
    isoStr: now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0'),
  };
}

/* Three-warning invalidation, extracted from the corrective monitor:
   - a breach sustained past `graceSec` costs a warning;
   - the third warning invalidates the session;
   - a single breach sustained past `sustainSec` invalidates outright;
   - returning to position clears the breach clock but never refunds warnings.
   tick() returns the action the caller must take; an invalidated session is
   discarded entirely — never delivered, never trimmed into a partial take. */
export function createStrikeMonitor(opts) {
  const graceSec = (opts && opts.graceSec) != null ? opts.graceSec : 2.5;
  const sustainSec = (opts && opts.sustainSec) != null ? opts.sustainSec : 12;
  const maxStrikes = (opts && opts.maxStrikes) != null ? opts.maxStrikes : 3;
  const m = { strikes: 0, breachAt: null, warned: false, issue: null, invalidReason: null };
  m.tick = (issues, now) => {
    if (m.invalidReason) return { invalidate: m.invalidReason };
    if (issues && issues.length) {
      m.issue = issues[0];
      if (m.breachAt == null) { m.breachAt = now; m.warned = false; }
      const sec = (now - m.breachAt) / 1000;
      if (sec > graceSec && !m.warned) {
        m.warned = true;
        m.strikes++;
        if (m.strikes >= maxStrikes) {
          m.invalidReason = 'three warnings (' + issues[0].toLowerCase() + ')';
          return { invalidate: m.invalidReason };
        }
        return { warn: m.strikes };
      }
      if (sec > sustainSec) {
        m.invalidReason = 'sustained breach (' + issues[0].toLowerCase() + ')';
        return { invalidate: m.invalidReason };
      }
    } else {
      m.issue = null;
      m.breachAt = null;
    }
    return null;
  };
  return m;
}
