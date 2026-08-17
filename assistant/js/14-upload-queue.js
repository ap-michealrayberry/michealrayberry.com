(function (MRB) {
  "use strict";

  var DB_NAME = "mrb_record_queue";
  var DB_VER = 1;
  var STORE = "sessions";
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("IDB open failed"));
      };
    });
    return dbPromise;
  }

  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  async function putSession(record) {
    var db = await openDb();
    var tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).put(record));
    return record.id;
  }

  async function getAll() {
    var db = await openDb();
    var tx = db.transaction(STORE, "readonly");
    return idbReq(tx.objectStore(STORE).getAll());
  }

  async function remove(id) {
    var db = await openDb();
    var tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).delete(id));
  }

  async function get(id) {
    var db = await openDb();
    var tx = db.transaction(STORE, "readonly");
    return idbReq(tx.objectStore(STORE).get(id));
  }

  /**
   * Chunked relay into the AP's Google Drive via Apps Script (vidinit opens a
   * resumable Drive session; each vidchunk forwards ~4 MB base64 — a multiple
   * of 256 KiB, as the Drive resumable protocol requires). kind=corrective
   * lands in the PRIVATE archive folder; everything else in the shared photos
   * folder, where importPhotos files it onto the record.
   */
  var DRIVE_CHUNK = 4 * 1024 * 1024;

  function blobChunkB64(blob, offset, size) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(fr.error || new Error("chunk read failed")); };
      fr.onload = function () {
        var s = String(fr.result || ""); // data:<mime>;base64,XXXX
        resolve(s.slice(s.indexOf(",") + 1));
      };
      fr.readAsDataURL(blob.slice(offset, Math.min(offset + size, blob.size)));
    });
  }

  function driveName(item, blob) {
    var ext = /webm/i.test(item.mime || blob.type || "") ? "webm" : "mp4";
    var day3 = ("00" + (item.day || 0)).slice(-3);
    var stem = { daily: "inspection", corrective: "corrective-session", weekly: "weekly-review", confirmation: "consent-confirmation", demo: "demonstration" }[item.kind] || item.kind;
    return "micheal-ray-berry-day-" + day3 + "-" + stem + "-" + item.date + "." + ext;
  }

  async function driveRelayUpload(item, blob, statusWriter) {
    var cfg = MRB.config.get();
    if (cfg.demoMode) return { ok: true, demo: true, url: "" };
    var total = blob.size;
    var session = item.driveSession || null; // reuse a still-open session on retry
    var offset = session ? (item.uploadOffset || 0) : 0;
    if (!session) {
      var init = await MRB.api.postJson({
        action: "vidinit",
        key: cfg.deviceKey,
        kind: item.kind,
        name: driveName(item, blob),
        mime: item.mime || blob.type || "video/webm",
        size: total,
      });
      if (!init || !init.ok || !init.session) throw new Error((init && init.error) || "vidinit failed");
      session = init.session;
      item.driveSession = session;
      item.uploadOffset = 0;
      offset = 0;
      await putSession(item);
    }
    while (offset < total) {
      var b64 = await blobChunkB64(blob, offset, DRIVE_CHUNK);
      var r = await MRB.api.postJson({
        action: "vidchunk",
        key: cfg.deviceKey,
        session: session,
        mime: item.mime || blob.type || "video/webm",
        offset: offset,
        total: total,
        chunk_b64: b64,
      });
      if (!r || !r.ok) {
        // A dead Drive session must not wedge the queue — clear it so the
        // next attempt starts fresh from byte 0.
        if (r && /chunk 4/i.test(String(r.error || ""))) { item.driveSession = null; item.uploadOffset = 0; await putSession(item); }
        var err = new Error((r && r.error) || "vidchunk failed");
        err.offset = offset;
        throw err;
      }
      offset = Math.min(offset + DRIVE_CHUNK, total);
      item.uploadOffset = offset;
      await putSession(item);
      if (statusWriter) statusWriter("Uploading " + item.kind + " — " + Math.round((offset / total) * 100) + "% of " + formatBytes(total));
      if (r.done) return { ok: true, url: r.url || "" };
    }
    return { ok: true, url: "" };
  }

  /* Legacy direct PUT — kept for any old queue item that still carries a
     presigned URL; new uploads all go through driveRelayUpload. */
  async function resumablePut(uploadUrl, blob, onProgress, priorOffset) {
    var offset = priorOffset || 0;
    var total = blob.size;
    var cfg = MRB.config.get();

    // Demo mode: skip real network
    if (cfg.demoMode || (uploadUrl && uploadUrl.indexOf("example.invalid") >= 0)) {
      if (onProgress) onProgress(total, total);
      return { ok: true, demo: true };
    }

    // Try full PUT first (R2 common path); on failure mid-way, store offset
    var slice = offset > 0 ? blob.slice(offset) : blob;
    var headers = {
      "Content-Type": blob.type || "application/octet-stream",
    };
    if (offset > 0) {
      headers["Content-Range"] = "bytes " + offset + "-" + (total - 1) + "/" + total;
    }

    var res = await fetch(uploadUrl, {
      method: "PUT",
      body: slice,
      headers: headers,
    });

    if (!res.ok) {
      var err = new Error("Upload failed HTTP " + res.status);
      err.offset = offset;
      throw err;
    }
    if (onProgress) onProgress(total, total);
    return { ok: true, status: res.status };
  }

  async function enqueue(sessionRecord) {
    var id =
      sessionRecord.id ||
      "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    var rec = Object.assign({}, sessionRecord, {
      id: id,
      queuedAt: new Date().toISOString(),
      lastAttempt: null,
      nextRetry: null,
      attempts: sessionRecord.attempts || 0,
      uploadOffset: sessionRecord.uploadOffset || 0,
      status: "waiting",
    });
    await putSession(rec);
    return rec;
  }

  async function processQueue(statusWriter) {
    var items = await getAll();
    var waiting = items.filter(function (x) {
      return x.status === "waiting" || x.status === "error";
    });
    for (var i = 0; i < waiting.length; i++) {
      var item = waiting[i];
      try {
        item.status = "uploading";
        item.lastAttempt = new Date().toISOString();
        item.attempts = (item.attempts || 0) + 1;
        await putSession(item);
        if (statusWriter) {
          statusWriter(
            "Uploading " + item.kind + " (" + formatBytes(item.blobSize || 0) + ")…"
          );
        }
        await fileItem(item, statusWriter);
        item.status = "done";
        await putSession(item);
        await remove(item.id);
      } catch (e) {
        item.status = "error";
        item.lastError = e.message || String(e);
        item.nextRetry = new Date(Date.now() + Math.min(300000, 5000 * item.attempts)).toISOString();
        if (e.offset != null) item.uploadOffset = e.offset;
        await putSession(item);
        if (statusWriter) statusWriter("Upload error: " + item.lastError);
      }
    }
  }

  async function fileItem(item, statusWriter) {
    // Rebuild blob from stored ArrayBuffer if needed
    var blob = item.blob;
    if (!blob && item.blobBuffer) {
      blob = new Blob([item.blobBuffer], { type: item.mime || "video/webm" });
    }
    if (!blob) throw new Error("No blob in queue item");

    // Every take ships to the AP's Google Drive as a BACKUP copy — for corrective
    // sessions the public YouTube posting remains the evidence and the thing
    // that resolves the entry; this copy is disaster recovery only.
    var up = await driveRelayUpload(item, blob, statusWriter);

    var attestBody = {
      date: item.date,
      day: item.day,
      kind: item.kind,
      code: item.code,
      video_sha256: item.video_sha256,
      chunk_chain: item.chunk_chain,
      chunk_count: item.chunk_count,
    };
    if (item.weight != null) attestBody.weight = item.weight;
    if (item.photo_sha256s) attestBody.photo_sha256s = item.photo_sha256s;

    var seal = await MRB.api.attest(attestBody);
    item.seal = seal.seal;
    item.sealed_at = seal.sealed_at;
    item.publicUrl = up.url || "";

    if (item.kind === "daily" && item.photos) {
      for (var p = 0; p < item.photos.length; p++) {
        var ph = item.photos[p];
        await MRB.api.packet({
          date: item.date,
          name: ph.name,
          image_b64: ph.b64,
          weight: p === 0 ? item.weight : undefined,
          finalize: false,
        });
      }
      await MRB.api.packet({
        date: item.date,
        weight: item.weight,
        video_url: sign.publicUrl,
        finalize: true,
      });
    } else if (item.kind === "weekly") {
      await MRB.api.apweekly({
        date: item.date,
        week: item.week,
        documented: item.documented,
        required: item.required,
        weight: item.weight,
        open: item.openCount,
        url: sign.publicUrl,
      });
    } else if (item.kind === "confirmation") {
      await MRB.api.apconfirmation({
        date: item.date,
        version: item.version,
        day: item.day,
        url: sign.publicUrl,
      });
    } else if (item.kind === "corrective") {
      // Backup uploaded above; nothing filed to the record yet. Posting the
      // take to YouTube and filing the link on the result screen is what
      // resolves the entry (correctivefiled).
    } else {
      // demo — the attestation is enough
    }

    if (statusWriter) statusWriter("Filed and sealed.");
    return item;
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function queueSummary() {
    try {
      var items = await getAll();
      var active = items.filter(function (x) {
        return x.status !== "done";
      });
      return {
        count: active.length,
        items: active.map(function (x) {
          return {
            id: x.id,
            kind: x.kind,
            size: x.blobSize || 0,
            status: x.status,
            lastAttempt: x.lastAttempt,
            nextRetry: x.nextRetry,
            code: x.code,
            error: x.lastError || null,
          };
        }),
      };
    } catch (e) {
      return { count: 0, items: [], error: e.message };
    }
  }

  async function blobToBuffer(blob) {
    return await blob.arrayBuffer();
  }

  MRB.queue = {
    enqueue: enqueue,
    processQueue: processQueue,
    queueSummary: queueSummary,
    resumablePut: resumablePut,
    formatBytes: formatBytes,
    blobToBuffer: blobToBuffer,
    getAll: getAll,
    remove: remove,
  };
})(window.MRB);
