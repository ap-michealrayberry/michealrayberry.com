(function (MRB) {
  "use strict";

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var i = 0;
    var inQuotes = false;
    text = String(text || "").replace(/^\uFEFF/, "");
    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      field += c;
      i++;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows || !rows.length) return [];
    var headers = rows[0].map(function (h) {
      return String(h || "").trim().toLowerCase().replace(/\s+/g, "_");
    });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var obj = {};
      var empty = true;
      for (var c = 0; c < headers.length; c++) {
        var v = rows[r][c] != null ? String(rows[r][c]).trim() : "";
        if (v) empty = false;
        obj[headers[c]] = v;
      }
      if (!empty) out.push(obj);
    }
    return out;
  }

  /**
   * Open unless status begins resolved / satisfied / closed (case-insensitive).
   */
  function isOpenEntry(row) {
    var status = String(row.status || row.Status || "").trim().toLowerCase();
    if (!status) return true;
    if (status.indexOf("resolved") === 0) return false;
    if (status.indexOf("satisfied") === 0) return false;
    if (status.indexOf("closed") === 0) return false;
    return true;
  }

  function parseViolationLog(csvText) {
    var rows = rowsToObjects(parseCsv(csvText));
    return rows.map(function (r, idx) {
      var dateParsed = MRB.dates.parseDate(r.date);
      return {
        raw: r,
        index: idx,
        date: dateParsed ? dateParsed.iso : r.date,
        dateParsed: dateParsed,
        violation: r.violation || "",
        status: r.status || "",
        submitted: r.submitted || "",
        resolved: r.resolved || "",
        ap_verification: r.ap_verification || "",
        corrections: r.corrections || "",
        open: isOpenEntry(r),
      };
    });
  }

  function parseWeighIns(csvText) {
    var rows = rowsToObjects(parseCsv(csvText));
    return rows.map(function (r) {
      var dateParsed = MRB.dates.parseDate(r.date);
      return {
        raw: r,
        date: dateParsed ? dateParsed.iso : r.date,
        dateParsed: dateParsed,
        weight_lb: r.weight_lb ? parseFloat(r.weight_lb) : null,
        note: r.note || "",
        photo_front: r.photo_front || "",
        photo_left: r.photo_left || "",
        photo_rear: r.photo_rear || "",
        photo_right: r.photo_right || "",
        video: r.video || "",
      };
    });
  }

  /** Confirmed violations count → level capped at 3. */
  function violationLevel(entries) {
    var confirmed = 0;
    for (var i = 0; i < entries.length; i++) {
      var s = String(entries[i].status || "").toLowerCase();
      // open or confirmed-style statuses count toward accumulated level
      if (s.indexOf("confirmed") >= 0 || s.indexOf("open") === 0 || entries[i].open) {
        // count resolved-as-confirmed too for level — use all non-empty with violation text
      }
      if (entries[i].violation) confirmed++;
    }
    // Level follows accumulated count of confirmed violations, capped at 3
    // Prefer rows whose status indicates confirmed / assigned corrective
    var n = 0;
    for (var j = 0; j < entries.length; j++) {
      var st = String(entries[j].status || "").toLowerCase();
      if (
        st.indexOf("confirmed") >= 0 ||
        st.indexOf("corrective") >= 0 ||
        st.indexOf("assigned") >= 0 ||
        (entries[j].open && entries[j].violation)
      ) {
        n++;
      }
    }
    if (n === 0 && confirmed > 0) n = confirmed;
    return Math.max(1, Math.min(3, n || 1));
  }

  MRB.csv = {
    parseCsv: parseCsv,
    rowsToObjects: rowsToObjects,
    isOpenEntry: isOpenEntry,
    parseViolationLog: parseViolationLog,
    parseWeighIns: parseWeighIns,
    violationLevel: violationLevel,
  };
})(window.MRB);
