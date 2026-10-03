(function (MRB) {
  "use strict";

  /**
   * Accept both ISO (2026-07-31) and US (7/31/2026) spreadsheet exports.
   * A strict ISO-only parser once made a log with three open entries read empty.
   */
  function parseDate(value) {
    if (value == null) return null;
    var s = String(value).trim();
    if (!s) return null;

    // ISO yyyy-mm-dd
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (iso) {
      return {
        y: +iso[1],
        m: +iso[2],
        d: +iso[3],
        iso: pad4(+iso[1]) + "-" + pad2(+iso[2]) + "-" + pad2(+iso[3]),
      };
    }

    // US m/d/yyyy or m/d/yy
    var us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (us) {
      var y = +us[3];
      if (y < 100) y += 2000;
      return {
        y: y,
        m: +us[1],
        d: +us[2],
        iso: pad4(y) + "-" + pad2(+us[1]) + "-" + pad2(+us[2]),
      };
    }

    // Fallback Date parse
    var t = Date.parse(s);
    if (!isNaN(t)) {
      var dt = new Date(t);
      return {
        y: dt.getUTCFullYear(),
        m: dt.getUTCMonth() + 1,
        d: dt.getUTCDate(),
        iso:
          pad4(dt.getUTCFullYear()) +
          "-" +
          pad2(dt.getUTCMonth() + 1) +
          "-" +
          pad2(dt.getUTCDate()),
      };
    }
    return null;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }
  function pad4(n) {
    var s = String(n);
    while (s.length < 4) s = "0" + s;
    return s;
  }

  function padDay(n) {
    var s = String(n | 0);
    while (s.length < 3) s = "0" + s;
    return s;
  }

  /** Format for overlay: YYYY-MM-DD from server day/date, never device clock for evidence. */
  function formatOverlayDate(isoOrDate) {
    var p = parseDate(isoOrDate);
    return p ? p.iso : String(isoOrDate || "");
  }

  /**
   * Eastern Time helpers for 10 PM ET deadline countdown.
   * Display-only; not used for evidentiary timestamps.
   */
  function nowInET() {
    try {
      return new Date(
        new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
      );
    } catch (e) {
      return new Date();
    }
  }

  function msUntil10pmET() {
    var et = nowInET();
    var target = new Date(et.getTime());
    target.setHours(22, 0, 0, 0);
    if (et.getTime() >= target.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime() - et.getTime();
  }

  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s);
  }

  function formatMmSs(totalSec) {
    totalSec = Math.max(0, Math.floor(totalSec));
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return pad2(m) + ":" + pad2(s);
  }

  MRB.dates = {
    parseDate: parseDate,
    pad2: pad2,
    pad4: pad4,
    padDay: padDay,
    formatOverlayDate: formatOverlayDate,
    nowInET: nowInET,
    msUntil10pmET: msUntil10pmET,
    formatCountdown: formatCountdown,
    formatMmSs: formatMmSs,
  };
})(window.MRB);
