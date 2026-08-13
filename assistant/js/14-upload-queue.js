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
   * Resumable PUT using Range / Content-Range when server supports it.
   * For R2 presigned URLs, often full PUT only — we still track offset and
   * retry from last acknowledged byte when possible.
   */
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

    // Video backup used to go to Cloudflare R2. That path is retired.
    // If the server still signs an upload, we send a disaster-recovery copy;
    // otherwise we skip straight to attestation + Drive photos + YouTube.
    var sign = null;
    var publicUrl = "";
    try {
      sign = await MRB.api.r2sign(item.kind, item.date, item.mime || blob.type || "video/mp4");
    } catch (e) {
      var msg = (e && e.message) || String(e);
      if (!/R2 not configured|r2sign failed|missing uploadUrl/i.test(msg)) throw e;
      sign = { skipped: true };
    }
    if (sign && !sign.skipped && sign.uploadUrl && String(sign.uploadUrl).indexOf("example.invalid") < 0) {
      var uploadUrl = MRB.api.readUploadUrl(sign);
      await resumablePut(uploadUrl, blob, null, item.uploadOffset || 0);
      publicUrl = sign.publicUrl || "";
    } else if (statusWriter) {
      statusWriter("No video bucket — filing photos to Drive. Post the take to YouTube after.");
    }

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
    item.publicUrl = publicUrl;

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
        video_url: publicUrl || undefined,
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
