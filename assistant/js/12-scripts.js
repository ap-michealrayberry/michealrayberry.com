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
    return [
      {
        id: "wait_open",
        label: "Opening — Wait",
        sec: 12,
        pose: "WAIT POSITION",
        text:
          "This is the official Daily Inspection for Micheal Ray Berry, Day " +
          n +
          ". Today is " +
          date +
          ". Documented weight: " +
          w +
          " pounds. Remain in Wait position. Full project uniform clearly visible. " +
          "This is one continuous take. Verification code is displayed on screen.",
      },
      {
        id: "inspection",
        label: "Front — Inspection",
        sec: 8,
        pose: "INSPECTION · HANDS BEHIND HEAD",
        text:
          "Inspection position. Feet shoulder-width apart. Hands behind the head. Eyes forward. Hold.",
      },
      {
        id: "left",
        label: "Left",
        sec: 5,
        pose: "LEFT PROFILE · HANDS BEHIND HEAD",
        text: "Left profile. Turn left. Hold.",
      },
      {
        id: "rear",
        label: "Rear",
        sec: 5,
        pose: "REAR · HANDS BEHIND HEAD",
        text: "Rear view. Turn to the rear. Hold.",
      },
      {
        id: "right",
        label: "Right",
        sec: 5,
        pose: "RIGHT PROFILE · HANDS BEHIND HEAD",
        text: "Right profile. Turn right. Hold.",
      },
      {
        id: "front_close",
        label: "Front — Closing View",
        sec: 6,
        pose: "FRONT · HANDS BEHIND HEAD",
        text: "Front. Return to the front. Hold. Four required views complete.",
      },
      {
        id: "wait_close",
        label: "Return to Wait — Completion",
        sec: 10,
        pose: "WAIT POSITION",
        text:
          "Wait position. Hold. The remaining Daily Compliance Packet requirements " +
          "are due by ten PM Eastern. Up, down, or flat, it gets posted. Daily Inspection complete. Release.",
      },
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
          "This is a Corrective Session for Micheal Ray Berry under the Public Accountability Project. " +
          "The entry being corrected is " +
          violation +
          ", dated " +
          date +
          ". This is Level " +
          level +
          ", with an assigned duration of " +
          minutes +
          " minutes. Remain in Wait position. Full project uniform clearly visible. " +
          "This is one continuous take. Verification code is displayed on screen.",
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
            "Halfway. The purpose of this session is accountability for the documented compliance failure. Maintain the Corner Position.",
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
            "Halfway. The purpose of this session is accountability for the documented compliance failure. Maintain the Corner Position.",
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
          "Halfway. The purpose of this session is accountability for the documented compliance failure. Maintain the Corner Position.",
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
      return "Halfway. The purpose of this session is accountability for the documented compliance failure. Maintain the Corner Position.";
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
    return (
      "Time complete. Before release, the record states the failure in full. " +
      "Micheal Ray Berry failed " + v + (d ? ", dated " + fmtDateLong(d) : "") + ". " +
      "The compliance entry remains documented. This completed capture still requires sealing, public filing, and Accountability Partner verification; it does not itself close or erase the entry. " +
      "Wait position."
    );
  }

  function cornerClosing(ctx) {
    return (
      "Remain in Wait position. Hands behind the back. Head upright. Eyes forward. Hold. " +
      "Level " +
      (ctx.level || 1) +
      " Corrective Session capture is complete. It is ready to be sealed and backed up; public filing and Accountability Partner verification remain pending. Session complete. Release."
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

  function confirmationScript(ctx) {
    return (
      "I am Micheal Ray Berry. This is my participant statement for Accountability Partner review concerning the Public Accountability Project terms, version " +
      (ctx.version || "1") +
      ", recorded on " +
      fmtDateLong(ctx.date) +
      ". " +
      "I have reviewed the final terms presented to me, understand the stated documentation and publication scope, and voluntarily consent to them subject to the published safety, privacy, and legal limits. I understand that withdrawal, lawful redaction, and safety or privacy takedown remain available. " +
      "This statement is read by a synthetic voice while I appear on camera. My appearance and this recording are evidence submitted for review; they do not independently prove comprehension, voluntariness, or bilateral execution. Edition 2 remains inactive unless the Accountability Partner separately verifies this statement and both signatures."
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
    confirmationScript: confirmationScript,
    demoScript: demoScript,
    fmtDateLong: fmtDateLong,
  };
})(window.MRB);
