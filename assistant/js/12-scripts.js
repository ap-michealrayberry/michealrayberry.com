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
            "Five minutes remaining. Completion of this session satisfies the assigned corrective requirement. It does not remove the original violation from the record. Maintain the Corner Position.",
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
          "Twenty minutes remaining. The original compliance failure remains part of the permanent project record. Maintain the Corner Position.",
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
          "Five minutes remaining. Completion of this session satisfies the assigned corrective requirement. It does not remove the original violation from the record. Maintain the Corner Position.",
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
      return "Five minutes remaining. Completion of this session satisfies the assigned corrective requirement. It does not remove the original violation from the record. Maintain the Corner Position.";
    }
    return m + " minutes remaining. Maintain the Corner Position.";
  }

  function cornerTimerComplete(ctx) {
    var v = (ctx && ctx.violation) || "the documented compliance failure";
    var d = ctx && (ctx.violationDate || ctx.date);
    return (
      "Time complete. Before release, the record states the failure in full. " +
      "Micheal Ray Berry failed " + v + (d ? ", dated " + fmtDateLong(d) : "") + ". " +
      "The failure is permanent. This session closes the corrective requirement; it does not erase the entry. " +
      "Wait position."
    );
  }

  function cornerClosing(ctx) {
    return (
      "Remain in Wait position. Hands behind the back. Head upright. Eyes forward. Hold. " +
      "Level " +
      (ctx.level || 1) +
      " Corrective Session is complete. Completion of the corrective requirement is filed to the project record. Session complete. Release."
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
    if (totalChange != null) lines.push("Total change since Day One: " + totalChange + " pounds.");
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

  function weeklyToCorner() {
    return (
      "Corner position. Turn around and face the corner. Do not lean against either wall. Feet planted, shoulder-width apart. Hands behind the head. " +
      "Hold for fifteen minutes."
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
      "This is a consent confirmation for the Public Accountability Project, version " +
      (ctx.version || "1") +
      ", recorded on " +
      fmtDateLong(ctx.date) +
      ". " +
      "Stand facing the camera with hands behind the head. Micheal Ray Berry states for the record that he has read the agreement, understands its terms, and participates voluntarily. He consents by name to the reputational exposure inherent in real-name documentation of his body, his missed requirements, rejected submissions, corrective recordings, failed attempts, and any ending without verified completion — and he states that this is what he asked for, within the written limits. " +
      "The project is a voluntary accountability arrangement between adults, created at his own written request: a weight commitment from three hundred forty toward two hundred pounds, administered by the Accountability Partner, who owns the site, the data, and every key. Micheal Ray Berry cannot edit, soften, or remove any entry, and the record is public and permanent under his real name. He wears the project uniform. " +
      "He grants the Accountability Partner a license to repost, share, mirror, and archive public content anywhere for the project's accountability and documentation purpose, and — under section ten point two c — to republish public record content on the Partner's own platforms. He knows who the Accountability Partner is and accepts their administration and republication of this record. Private verification photographs and unpublished material are never included. He accepts that public content may be copied and reused by others beyond either party's control. " +
      "He understands that violations are declared automatically from the evidence, that the Accountability Partner has no discretion to excuse or soften them and may only confirm or reject them against the written rules, and that he has forty-eight hours to contest with evidence before a determination stands. " +
      "He understands that each confirmed violation is answered by corner time, ten, twenty, or thirty minutes by level, recorded in one unbroken take in the project uniform, posted publicly to the channel and embedded on the record beside the entry, and completed within seventy-two hours of the notice, and that missing that deadline is itself a new violation at the next level. " +
      "Participation ends only by verified completion, by written mutual release, or by the project ending without completion. " +
      "This statement is re-recorded whenever the agreement is amended."
    );
  }

  function demoScript() {
    return (
      "This is a demonstration of the Public Accountability Project capture standard. Stand facing the camera with hands behind the head. " +
      "It is not a session, not a consequence, and answers no violation. " +
      "The overlay reads demonstration, not a session. " +
      "A real session uses one continuous take, a challenge code burned into every frame, a rolling hash chain, and dual-path narration. " +
      "This demonstration ends here."
    );
  }

  function announcementScript() {
    return (
      "This is the official announcement of the Micheal Ray Berry Public Accountability Project. The man on camera is Micheal Ray Berry. He does not speak; the record speaks for him. The arrangement is voluntary, between adults, created at his own written request, with consent and hard limits in writing. He wears the uniform because he asked to. " +
      "His declared starting weight is three hundred forty pounds, and he has committed, in a signed agreement, to reach two hundred and hold it for twenty-eight consecutive days, documented in public under his real name, every day, until it is done. " +
      "Every day by ten PM Eastern: a four-angle inspection video, four photographs, a weight entry, and a tracker update, published to the official record and posted publicly to this channel. Every week: a weekly review. The weight itself is never a violation. Only a failure to document is. " +
      "A missed requirement is entered permanently in the public violation log and answered by corner time, ten, twenty, or thirty minutes by level, recorded in one unbroken take and published beside the entry. " +
      "Micheal Ray Berry does not administer this record. An independent Accountability Partner owns the site, the data, and every key. He cannot edit an entry, soften a description, remove a recording, or take the site down. That separation is the mechanism. " +
      "There are exactly three ways this ends. He reaches two hundred and holds it, verified. Both parties release him in writing. Or he stops, and this site becomes his permanent abandonment record, stated factually, forever. " +
      "Day one begins August thirty-first, twenty twenty-six. There is no unrecorded ending to this project."
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
    weeklyToCorner: weeklyToCorner,
    weeklyAssessment: weeklyAssessment,
    weeklyWeightMid: weeklyWeightMid,
    weeklyClosing: weeklyClosing,
    confirmationScript: confirmationScript,
    demoScript: demoScript,
    fmtDateLong: fmtDateLong,
  };
})(window.MRB);
