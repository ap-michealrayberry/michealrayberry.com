(function (MRB) {
  "use strict";

  function fmtDateLong(iso) {
    var p = MRB.dates.parseDate(iso);
    if (!p) return iso;
    var months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return months[p.m - 1] + " " + p.d + ", " + p.y;
  }

  /**
   * Daily inspection — official sequence (~55–65s):
   * WAIT → INSPECTION → LEFT → REAR → RIGHT → FRONT → WAIT → COMPLETE
   * Synthetic narration only · one continuous take.
   */
  function dailySegments(ctx) {
    var n = ctx.day;
    var date = fmtDateLong(ctx.date);
    var w = ctx.weight;
    // Published sequence: WAIT → FRONT → LEFT → REAR → RIGHT → WAIT (/positions/).
    return [
      { id: "wait_open", label: "Opening — Wait", sec: 12, pose: "WAIT POSITION",
        text: "Micheal Ray Berry. Daily Inspection. Day " + n + ". " + date + ". Documented weight: " + w + " pounds. " +
          "Full project uniform visible. One continuous take. Verification code on screen. " +
          "This inspection is part of your chosen submission. Follow the agreed protocol and present yourself for review. " +
          "Present Wait. Hold." },
      { id: "inspection", label: "Front", sec: 8, pose: "FRONT · HANDS BEHIND HEAD", text: "Present Front. Hold." },
      { id: "left", label: "Left", sec: 5, pose: "LEFT PROFILE · HANDS BEHIND HEAD", text: "Present Left. Hold." },
      { id: "rear", label: "Rear", sec: 5, pose: "REAR · HANDS BEHIND HEAD", text: "Present Rear. Hold." },
      { id: "right", label: "Right", sec: 5, pose: "RIGHT PROFILE · HANDS BEHIND HEAD", text: "Present Right. Hold." },
      { id: "wait_close", label: "Closing — Wait", sec: 10, pose: "WAIT POSITION",
        text: "Present Wait. Hold. Inspection sequence complete. Submit the full Daily Compliance Packet by ten PM Eastern. Accountability Partner review pending. Release." },
    ];
  }

  function photoPrompts() {
    return [
      {
        id: "front",
        label: "Front",
        text: "Front photograph. Inspection position. Feet shoulder-width apart. Hands behind the head. Hold.",
        pose: "FRONT · HANDS BEHIND HEAD",
      },
      {
        id: "left",
        label: "Left",
        text: "Left profile photograph. Left profile. Hands behind the head. Hold.",
        pose: "LEFT PROFILE · HANDS BEHIND HEAD",
      },
      {
        id: "rear",
        label: "Rear",
        text: "Rear photograph. Rear view. Hands behind the head. Hold.",
        pose: "REAR · HANDS BEHIND HEAD",
      },
      {
        id: "right",
        label: "Right",
        text: "Right profile photograph. Right profile. Hands behind the head. Hold.",
        pose: "RIGHT PROFILE · HANDS BEHIND HEAD",
      },
    ];
  }

  /**
   * Corrective Session (public name). Posture during hold = Corner Position.
   * Sequence: WAIT → CORNER → WAIT
   * Level 1 = 10 min · Level 2 = 20 min · Level 3 = 30 min
   */
  function cornerSegments(ctx) {
    var date = fmtDateLong(ctx.violationDate || ctx.date);
    var violation = ctx.violation || "a confirmed violation";
    var level = ctx.level || 1;
    var minutes = ctx.minutes || 10;
    return [
      {
        id: "wait_open",
        label: "Opening — Wait",
        sec: 16,
        pose: "WAIT POSITION",
        text:
          "Micheal Ray Berry. Corrective Session. Confirmed violation: " + violation + ". Violation date: " + date + ". " +
          "Assigned correction: Level " + level + ", " + minutes + " minutes. " +
          "You chose submission within this accountability arrangement. That includes completing the agreed correction when a requirement is missed. " +
          "Remain in Wait position. Full project uniform visible. One continuous take. Verification code on screen.",
      },
      {
        id: "to_corner",
        label: "Assume Corner Position",
        sec: 18,
        pose: "CORNER POSITION · HANDS BEHIND HEAD",
        text:
          "Corner position. Turn around and face the corner. Feet shoulder-width apart. Hands behind the head. " +
          "Do not lean against either wall. Eyes toward the corner. Hold the position. " +
          "This session was assigned because " +
          violation +
          " was not completed as required. The original entry remains part of the project record. " +
          "The timer begins now. Duration: " +
          minutes +
          " minutes.",
      },
    ];
  }

  function cornerOpening(ctx) {
    return cornerSegments(ctx)[0].text;
  }

  function cornerToCorner(ctx) {
    var segs = cornerSegments(ctx);
    return segs[segs.length - 1].text;
  }

  /**
   * Timed-hold lines keyed by remaining seconds (exact script per level).
   * Returns { atSec, text }[] sorted descending by atSec.
   */
  function cornerHoldMarks(level) {
    var n = Math.max(1, Math.min(3, level | 0));
    if (n === 1) {
      return [
        {
          atSec: 5 * 60,
          text:
            "Halfway. Follow the agreed correction through to completion. Maintain the required position. Acceptance remains subject to Accountability Partner review.",
        },
        {
          atSec: 60,
          text:
            "One minute remaining. Maintain the Corner Position until released by the timer.",
        },
      ];
    }
    if (n === 2) {
      return [
        {
          atSec: 10 * 60,
          text:
            "Halfway. Follow the agreed correction through to completion. Maintain the required position. Acceptance remains subject to Accountability Partner review.",
        },
        {
          atSec: 5 * 60,
          text:
            "Five minutes remaining. A completed capture may be submitted against the assigned corrective requirement; acceptance remains pending Accountability Partner verification. It does not remove the original violation from the record. Maintain the Corner Position.",
        },
        {
          atSec: 60,
          text:
            "One minute remaining. Maintain the Corner Position until released by the timer.",
        },
      ];
    }
    // Level 3 — 30 minutes
    return [
      {
        atSec: 20 * 60,
        text:
          "Twenty minutes remaining. The original compliance entry remains documented in the current public record. Maintain the Corner Position.",
      },
      {
        atSec: 15 * 60,
        text:
          "Halfway. Follow the agreed correction through to completion. Maintain the required position. Acceptance remains subject to Accountability Partner review.",
      },
      {
        atSec: 10 * 60,
        text: "Ten minutes remaining. Continue holding the required position.",
      },
      {
        atSec: 5 * 60,
        text:
          "Five minutes remaining. A completed capture may be submitted against the assigned corrective requirement; acceptance remains pending Accountability Partner verification. It does not remove the original violation from the record. Maintain the Corner Position.",
      },
      {
        atSec: 60,
        text:
          "One minute remaining. Maintain the Corner Position until released by the timer.",
      },
    ];
  }

  /** @deprecated generic interval — prefer cornerHoldMarks */
  function cornerInterval(minutesLeft, isHalf) {
    if (isHalf) {
      return "Halfway. Follow the agreed correction through to completion. Maintain the required position. Acceptance remains subject to Accountability Partner review.";
    }
    var m = Math.round(minutesLeft);
    if (m <= 1) {
      return "One minute remaining. Maintain the Corner Position until released by the timer.";
    }
    if (m === 5) {
      return "Five minutes remaining. A completed capture may be submitted against the assigned corrective requirement; acceptance remains pending Accountability Partner verification. It does not remove the original violation from the record. Maintain the Corner Position.";
    }
    return m + " minutes remaining. Maintain the Corner Position.";
  }

  function cornerTimerComplete(ctx) {
    var v = (ctx && ctx.violation) || "the documented compliance failure";
    var d = ctx && (ctx.violationDate || ctx.date);
    return "Assigned time complete. Return to Wait position.";
  }

  function cornerClosing(ctx) {
    var v = (ctx && ctx.violation) || "the confirmed violation";
    var d = ctx && (ctx.violationDate || ctx.date);
    return (
      "This recording documents the corrective session for " + v + (d ? ", dated " + fmtDateLong(d) : "") + ". " +
      "It does not erase the original entry. Public filing and Accountability Partner verification remain pending. " +
      "Session complete. Release."
    );
  }

  /**
   * Weekly review figures from the record only. Omit lines that cannot be computed.
   */
  function weeklyFigures(record, weekStartIso, dayOneWeight) {
    var weigh = (record && record.weighIns) || [];
    var viol = (record && record.violations) || [];
    var start = MRB.dates.parseDate(weekStartIso);
    if (!start) return { documented: 0, required: 7, missing: [], lines: [] };

    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
      var iso =
        MRB.dates.pad4(d.getUTCFullYear()) +
        "-" +
        MRB.dates.pad2(d.getUTCMonth() + 1) +
        "-" +
        MRB.dates.pad2(d.getUTCDate());
      days.push(iso);
    }

    var byDate = {};
    weigh.forEach(function (w) {
      if (w.date) byDate[w.date] = w;
    });

    var documented = 0;
    var missing = [];
    var weekWeights = [];
    days.forEach(function (iso) {
      if (byDate[iso] && byDate[iso].weight_lb != null && !isNaN(byDate[iso].weight_lb)) {
        documented++;
        weekWeights.push({ date: iso, w: byDate[iso].weight_lb });
      } else {
        missing.push(iso);
      }
    });

    var startW = weekWeights.length ? weekWeights[0].w : null;
    var endW = weekWeights.length ? weekWeights[weekWeights.length - 1].w : null;
    var change = startW != null && endW != null ? +(endW - startW).toFixed(1) : null;
    var totalChange =
      dayOneWeight != null && endW != null ? +(endW - dayOneWeight).toFixed(1) : null;
    var remaining = endW != null ? +(endW - 200).toFixed(1) : null;

    var open = viol.filter(function (v) {
      return v.open;
    });
    var oldest = open.length
      ? open.slice().sort(function (a, b) {
          return String(a.date).localeCompare(String(b.date));
        })[0]
      : null;

    var lines = [];
    lines.push("Days documented: " + documented + " of 7.");
    if (missing.length) lines.push("Dates missing: " + missing.join(", ") + ".");
    if (startW != null) lines.push("Weight at start of week: " + startW + " pounds.");
    if (endW != null) lines.push("Weight at end of week: " + endW + " pounds.");
    if (change != null) lines.push("Change across the week: " + change + " pounds.");
    if (totalChange != null) lines.push("Change from the declared 340-pound baseline: " + totalChange + " pounds.");
    if (remaining != null) lines.push("Distance remaining to two hundred: " + remaining + " pounds.");
    if (open.length) {
      lines.push("Open entries: " + open.length + ".");
      if (oldest) lines.push("Oldest open entry: " + oldest.date + " — " + oldest.violation + ".");
    } else {
      lines.push("Open entries: none.");
    }

    return {
      documented: documented,
      required: 7,
      missing: missing,
      startW: startW,
      endW: endW,
      change: change,
      totalChange: totalChange,
      remaining: remaining,
      open: open,
      oldest: oldest,
      lines: lines,
      assessment: weeklyAssessment(documented),
    };
  }

  function weeklyOpening(ctx) {
    return (
      "This is the Weekly Review for Micheal Ray Berry under the Public Accountability Project. " +
      "Week " +
      (ctx.week || "") +
      ". " +
      "Hands behind the head throughout. Everything stated in this session is taken from the record. Nothing is composed."
    );
  }

  function weeklyAssessment(documented) {
    return (
      "This week's documented days: " +
      documented +
      " of 7. Assessment is read from the record only."
    );
  }

  function weeklyWeightMid(endW) {
    if (endW == null || endW === "") {
      return "Weight figures are taken from the record.";
    }
    return "Most recent documented weight on the record: " + endW + " pounds.";
  }

  function weeklyClosing(ctx) {
    return (
      "Weekly review for week " +
      (ctx.week || "") +
      " is complete. " +
      (ctx.summaryLine || "") +
      " The numbers stand as read. Session ends. Release."
    );
  }

  /**
   * Recorded Consent Statement. Two-stage confirmation:
   * Inspection position = voluntary participation in the recording;
   * a deliberate nod inside the timed CONFIRMATION WINDOW = consent.
   * Stillness is never consent — the rejection rule is read aloud.
   * The statement is heard in Wait (arms down); Inspection is entered after.
   */
  function confirmationSegments(ctx) {
    var date = fmtDateLong(ctx.date);
    var code = ctx.code || "";
    var ed = String(ctx.version || "2");
    return [
      { id: "open", label: "Opening — Wait", sec: 6, pose: "WAIT POSITION · FACE CAMERA",
        text: "Public Accountability Project. Recorded consent statement. Recording date, " + date + ". Verification code, " + code + ". " +
          "The person appearing in this recording is Micheal Ray Berry. This is his recorded consent statement for the Public Accountability Project Agreement, made on " + date + ". " +
          "The narration is presented by a synthetic voice because Micheal Ray Berry will not speak during this recording. His participation and confirmation are communicated through deliberate physical actions explained in this statement." },
      { id: "look", label: "Look into camera", sec: 3, pose: "WAIT · LOOK INTO CAMERA", text: "Micheal Ray Berry, look directly into the camera." },
      { id: "statement", label: "Consent statement", sec: 0, pose: "WAIT · LISTEN",
        text: "Remain in Wait position while the complete consent statement is presented. The following words constitute Micheal Ray Berry's consent statement. " +
          "I am Micheal Ray Berry. Before making this recording, I received and read the complete Public Accountability Project Agreement. I understand its purpose, requirements, documentation standards, enforcement procedures, withdrawal provisions, and stated limits. " +
          "I had the opportunity to review the agreement, consider its consequences, ask questions, and request clarification before deciding whether to accept it. I understand that I should not confirm this statement if I have not read the agreement, do not understand a material term, or do not presently consent to participating. " +
          "I understand that the project creates a public accountability record under my real name. That record may include my weight, physical progress, daily inspections, photographs, recorded weigh-ins, required videos, completed requirements, missed deadlines, violations, corrective sessions, weekly summaries, and other information expressly authorized by the agreement. " +
          "I understand that these materials may be publicly accessible and may be viewed, saved, copied, discussed, indexed by search engines, or encountered by people I know. I understand that material published online cannot be guaranteed to disappear completely, even if it is later removed from the project's official website. " +
          "I understand that this accountability structure is intentionally demanding. Compliance may sometimes be uncomfortable, inconvenient, repetitive, or difficult. Those foreseeable feelings do not, by themselves, excuse a missed requirement or permit me to rewrite an accurate record after the fact. " +
          "I requested this structure because I want clear standards, consistent documentation, meaningful external accountability, and an accurate record of both compliance and failure. I understand that the project must record failures honestly if the accountability system is to remain credible. " +
          "I understand that I may not unilaterally edit, soften, conceal, rewrite, falsify, or remove an established project record merely because I later dislike it or regret it. Requests involving factual errors, personal safety, protected private information, withdrawal, or removal must be handled according to the procedures and limits stated in the agreement. " +
          "I understand that an accurate record may distinguish between the original entry and a later correction. A correction should preserve the integrity of the record while clearly identifying what was inaccurate and what information replaced it. " +
          "I understand that my participation does not eliminate my personal safety, privacy, legal rights, or ability to withdraw consent. Withdrawal may end future participation and future obligations, subject to the agreement's stated procedure. The treatment of accurate material published before withdrawal is governed by the agreement's record-retention, privacy, and safety provisions. " +
          "I understand that emergency intervention and safety-takedown procedures remain available when their stated conditions are met. Nothing in the agreement requires me to continue an activity that presents an immediate and genuine threat to health or safety. Nothing authorizes illegal conduct, medical neglect, financial consequences of any kind, workplace interference, or the disclosure of information excluded by the agreement. " +
          "I understand that this project includes a consensual submissive role. I am choosing to follow the Accountability Partner's direction within the written agreement. I understand the difference between following instructions during an agreed session and deciding whether I consent to participate. My consent is not established merely by following a command. " +
          "I understand that the Accountability Partner's authority exists only within the defined scope of the agreement. The Accountability Partner may review evidence, determine compliance, document violations, require agreed corrective actions, and administer the record as authorized by the agreement. That authority does not extend beyond the agreement or override its safety, privacy, legal, and withdrawal provisions. " +
          "I affirm that I requested this accountability arrangement voluntarily. I have not been threatened, forced, blackmailed, deceived, or improperly pressured into accepting it. I understand that declining to confirm this recording would prevent the agreement from taking effect and would not authorize anyone to represent that I consented. " +
          "I approved the language used in this recording before it began. I understand that a synthetic voice is presenting the statement while I appear on camera. My deliberate actions on camera are intended to document my identity, attention, and voluntary response. " +
          "This recording will be submitted to the Accountability Partner for verification. The agreement does not take effect merely because this video was recorded. It takes effect only after the recording has been reviewed, both parties have signed the agreement, and the Accountability Partner has formally confirmed activation. " +
          "The complete consent statement has now been presented." },
      { id: "participate", label: "Confirm participation — Inspection", sec: 8, pose: "ENTER INSPECTION · PARTICIPATION",
        text: "Micheal Ray Berry. You will now voluntarily move from the Wait position into the Inspection position. By doing so, you confirm that you are knowingly participating in this consent recording, that the complete agreement was made available to you before recording began, and that you have heard the complete statement. If you are participating voluntarily, enter the Inspection position now." },
      { id: "hold", label: "Hold — look into camera", sec: 4, pose: "INSPECTION · LOOK INTO CAMERA",
        text: "The Inspection position has been acknowledged. Remain in that position and look directly into the camera." },
      { id: "nod", label: "CONFIRMATION WINDOW", sec: 5, pose: "CONFIRMATION WINDOW · NOD TO CONSENT", tone: "warn",
        text: "If you have reviewed the complete agreement, understood this statement, and voluntarily consent to the agreement as of " + date + ", clearly nod your head now." },
      { id: "rule", label: "Rejection rule", sec: 2, pose: "INSPECTION · HOLD",
        text: "The nod must be deliberate and clearly visible. Silence, continued stillness, an unclear movement, or merely remaining in the Inspection position must not be treated as consent. If no clear nod occurred, this recording must be rejected and the agreement must not be activated. " +
          "If a clear nod occurred, Micheal Ray Berry's physical confirmation has been recorded. This confirmation remains subject to review by the Accountability Partner and completion of both signatures." },
      { id: "wait_close", label: "Return to Wait", sec: 5, pose: "WAIT POSITION · FACE CAMERA",
        text: "Micheal Ray Berry, you may now return to the Wait position. Remain facing the camera for five seconds." },
      { id: "close", label: "Close", sec: 3, pose: "WAIT POSITION",
        text: "This consent recording concluded on " + date + " using verification code " + code + "." },
    ];
  }
  // Single-string form of the same statement (transcripts, legacy callers).
  function confirmationScript(ctx) {
    return confirmationSegments(ctx).map(function (s) { return s.text; }).join(" ");
  }
  function confirmationScriptLegacy(ctx) {
    return (
      "I am Micheal Ray Berry. This is my participant statement for Accountability Partner review concerning the Public Accountability Project terms, version " +
      (ctx.version || "1") +
      ", recorded on " +
      fmtDateLong(ctx.date) +
      ". " +
      "I have reviewed the final terms presented to me, understand the stated documentation and publication scope, and voluntarily consent to them subject to the published safety, privacy, and legal limits. I understand that withdrawal, lawful redaction, and safety or privacy takedown remain available. " +
      "This statement is read by a synthetic voice while I appear on camera. My appearance and this recording are evidence submitted for review; they do not independently prove comprehension, voluntariness, or bilateral execution. The agreement remains pending unless the Accountability Partner separately verifies this statement and both signatures."
    );
  }

  function demoScript() {
    return (
      "This is a demonstration of the Public Accountability Project capture standard. Stand facing the camera with hands behind the head. " +
      "It is not a session, not a consequence, and answers no violation. " +
      "The overlay reads demonstration, not a session. " +
      "The production workflow is designed to use one continuous take, a displayed challenge code, a rolling hash chain, and recorded narration. Those signals assist review but do not independently prove authenticity. " +
      "This demonstration ends here."
    );
  }

  function announcementScript() {
    return (
      "This is an announcement of the Micheal Ray Berry Public Accountability Project. The man on camera is Micheal Ray Berry. The project was requested in writing, with published proposed limits. Agreement execution and consent are not established by this announcement. " +
      "His declared starting weight is three hundred forty pounds, and he has published a proposed commitment to reach two hundred and hold it for twenty-eight consecutive days, documented in public under his real name. The agreement is not in force unless both parties sign. " +
      "Every day by ten PM Eastern: a four-angle inspection video, four photographs, a weight entry, and a tracker update, published to the official record and posted publicly to this channel. Every week: a weekly review. The weight itself is never a violation. Only a failure to document is. " +
      "Under the proposed process, a confirmed missed requirement is entered in the public violation log and may require a recorded corrective session. Submission and Accountability Partner verification are separate steps. " +
      "The Accountability Partner administers the official record. Public entries may be corrected, redacted, or removed when safety, privacy, consent, or law requires it, with a transparent change notice where appropriate. " +
      "Day one is August thirty-first, twenty twenty-six. The agreement page reports the current execution status."
    );
  }

  MRB.scripts = {
    dailySegments: dailySegments,
    announcementScript: announcementScript,
    photoPrompts: photoPrompts,
    cornerSegments: cornerSegments,
    cornerOpening: cornerOpening,
    cornerToCorner: cornerToCorner,
    cornerHoldMarks: cornerHoldMarks,
    cornerInterval: cornerInterval,
    cornerTimerComplete: cornerTimerComplete,
    cornerClosing: cornerClosing,
    weeklyFigures: weeklyFigures,
    weeklyOpening: weeklyOpening,
    weeklyAssessment: weeklyAssessment,
    weeklyWeightMid: weeklyWeightMid,
    weeklyClosing: weeklyClosing,
    confirmationSegments: confirmationSegments,
    confirmationScript: confirmationScript,
    demoScript: demoScript,
    fmtDateLong: fmtDateLong,
  };
})(window.MRB);
