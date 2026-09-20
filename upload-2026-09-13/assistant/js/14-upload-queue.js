(function (MRB) {
  "use strict";

  var DB_NAME = "mrb_record_queue";
  var DB_VER = 2;
  var STORE = "sessions";
  var dbPromise = null;
  var UPLOAD_LEASE_MS = 20 * 60 * 1000;
  var SEAL_STORE_KEY = "mrb_attestation_seals_v1";

  function hasCurrentCorrectiveIdentity(item) {
    return /^V-[A-F0-9]{12}$/.test(String(item && item.vRef || "").trim().toUpperCase()) &&
      /^C-[A-F0-9]{24}$/.test(String(item && item.assignmentId || "").trim().toUpperCase()) &&
      /^A-[A-F0-9]{24}$/.test(String(item && item.attemptId || "").trim().toUpperCase());
  }

  function filingSealKey(item) {
    var kind = String(item && item.kind || "").toLowerCase();
    var date = String(item && item.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    if (kind === "corrective") {
      var ref = String(item.vRef || item.ref || "").trim().toUpperCase();
      var assignmentId = String(item.assignmentId || item.assignment_id || "").trim().toUpperCase();
      var attemptId = String(item.attemptId || item.attempt_id || "").trim().toUpperCase();
      return /^V-[A-F0-9]{12}$/.test(ref) && /^C-[A-F0-9]{24}$/.test(assignmentId) &&
        /^A-[A-F0-9]{24}$/.test(attemptId)
        ? kind + "|" + date + "|" + ref + "|" + assignmentId + "|" + attemptId : "";
    }
    if (kind === "weekly") {
      var week = Number(item.week);
      return isFinite(week) && Math.floor(week) === week && week > 0 ? kind + "|" + date + "|" + week : "";
    }
    if (kind === "confirmation") return kind + "|" + date + "|" + String(item.version || "2");
    return kind === "daily" ? kind + "|" + date : "";
  }

  function rememberFilingSeal(item) {
    var key = filingSealKey(item);
    var seal = String(item && item.seal || "").trim().toLowerCase();
    if (!key || !/^[a-f0-9]{64}$/.test(seal)) return false;
    try {
      var raw = localStorage.getItem(SEAL_STORE_KEY);
      var stored = raw ? JSON.parse(raw) : {};
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
      if (item.kind === "corrective") {
        var bucket = stored[key];
        if (!bucket || bucket.version !== 2 || !bucket.captures ||
            typeof bucket.captures !== "object" || Array.isArray(bucket.captures)) {
          bucket = { version: 2, captures: {} };
          if (/^[a-f0-9]{64}$/.test(String(stored[key] || ""))) {
            bucket.captures[stored[key]] = { seal: stored[key] };
          }
        }
        bucket.captures[seal] = {
          seal: seal, videoHash: item.video_sha256 || "",
          sealedAt: item.sealed_at || "", code: item.code || ""
        };
        stored[key] = bucket;
        localStorage.setItem(SEAL_STORE_KEY, JSON.stringify(stored));
        var confirmed = JSON.parse(localStorage.getItem(SEAL_STORE_KEY) || "{}");
        return !!(confirmed[key] && confirmed[key].captures && confirmed[key].captures[seal]);
      }
      if (stored[key] === "AMBIGUOUS") return false;
      if (stored[key] && stored[key] !== seal) {
        stored[key] = "AMBIGUOUS";
        localStorage.setItem(SEAL_STORE_KEY, JSON.stringify(stored));
        return false;
      }
      stored[key] = seal;
      localStorage.setItem(SEAL_STORE_KEY, JSON.stringify(stored));
      return true;
    } catch (error) {
      return false;
    }
  }

  function renewUploadLease(item) {
    item.leaseUntil = new Date(Date.now() + UPLOAD_LEASE_MS).toISOString();
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (event) {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        } else if (event.oldVersion < 2) {
          var store = req.transaction.objectStore(STORE);
          var cursorRequest = store.openCursor();
          cursorRequest.onsuccess = function () {
            var cursor = cursorRequest.result;
            if (!cursor) return;
            var item = cursor.value;
            if (String(item && item.kind || "").toLowerCase() === "corrective" &&
                !hasCurrentCorrectiveIdentity(item)) {
              item.status = "blocked";
              item.phase = "legacy-identity-missing";
              item.leaseUntil = null;
              item.nextRetry = null;
              item.lastError = "Legacy corrective capture retained locally; record a new attempt with current assignment identity.";
              cursor.update(item);
            }
            cursor.continue();
          };
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
    await new Promise(function (resolve, reject) {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = function () { reject(tx.error || new Error("Queue write did not commit")); };
      tx.objectStore(STORE).put(record);
    });
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
    // A previous page may have persisted the final offset just before it was
    // able to persist Drive's finalized URL. That state is not proof that the
    // URL is recoverable client-side, so restart instead of silently filing an
    // empty pointer.
    if (session && offset >= total) {
      if (item.publicUrl) return { ok: true, recovered: true, url: item.publicUrl };
      item.driveSession = null;
      item.uploadOffset = 0;
      item.phase = "video-restart-required";
      session = null;
      offset = 0;
      await putSession(item);
    }
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
      item.phase = "video-uploading";
      offset = 0;
      await putSession(item);
    }
    while (offset < total) {
      renewUploadLease(item);
      await putSession(item);
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
      if (r.done) {
        item.publicUrl = r.url || r.publicUrl || "";
        if (!item.publicUrl) {
          item.driveSession = null;
          item.uploadOffset = 0;
          item.phase = "video-restart-required";
          await putSession(item);
          throw new Error("Drive finalized the upload without returning its private URL");
        }
        item.phase = "video-uploaded";
      }
      await putSession(item);
      if (statusWriter) statusWriter("Uploading " + item.kind + " — " + Math.round((offset / total) * 100) + "% of " + formatBytes(total));
      if (r.done) return { ok: true, url: item.publicUrl };
    }
    item.driveSession = null;
    item.uploadOffset = 0;
    item.phase = "video-restart-required";
    await putSession(item);
    throw new Error("Drive upload ended without a finalized private URL");
  }

  /* R2 original + Stream playback copy, via the site's own /api/media-init
     (Cloudflare Pages Function). One PUT each; the Function mints both URLs. */
  async function mediaShip(item, blob, statusWriter) {
    var cfg = MRB.config.get();
    var init = await fetch("/api/media-init", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: cfg.deviceKey, kind: item.kind, date: item.date, day: item.day, mime: item.mime || blob.type || "video/mp4" }) })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    if (!init || !init.ok) throw new Error((init && init.error) || "media-init failed");
    if (!item.r2Key && init.r2_put_url) {
      if (statusWriter) statusWriter("Archiving original — " + formatBytes(blob.size));
      var r2 = await fetch(init.r2_put_url, { method: "PUT", body: blob, headers: { "content-type": item.mime || blob.type || "video/mp4" } });
      if (!r2.ok) throw new Error("R2 PUT " + r2.status);
      item.r2Key = init.r2_key; await putSession(item);
    }
    if (!item.streamUid && init.stream_url) {
      if (statusWriter) statusWriter("Uploading playback copy — " + formatBytes(blob.size));
      var fd = new FormData(); fd.append("file", blob, driveName(item, blob));
      var st = await fetch(init.stream_url, { method: "POST", body: fd });
      if (!st.ok) throw new Error("Stream upload " + st.status);
      item.streamUid = init.stream_uid; await putSession(item);
    }
    return { r2Key: item.r2Key || "", streamUid: item.streamUid || "" };
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
      phase: sessionRecord.phase || "queued",
      status: "waiting",
    });
    await putSession(rec);
    return rec;
  }

  var queueLock = null;

  async function processQueue(statusWriter) {
    if (queueLock) return queueLock;
    queueLock = processQueueInner(statusWriter).finally(function () {
      queueLock = null;
    });
    return queueLock;
  }

  async function processQueueInner(statusWriter) {
    var now = Date.now();
    var items = await getAll();
    var waiting = items.filter(function (x) {
      if (x.status === "uploading") {
        var lease = Date.parse(x.leaseUntil || "");
        if (!isNaN(lease) && lease > now) return false;
        x.status = "error";
        x.lastError = "Interrupted upload recovered for retry";
      }
      if (x.status !== "waiting" && x.status !== "error") return false;
      if (x.nextRetry) {
        var t = Date.parse(x.nextRetry);
        if (!isNaN(t) && t > now) return false;
      }
      return true;
    });
    var outcomes = [];
    for (var i = 0; i < waiting.length; i++) {
      var item = waiting[i];
      try {
        item.status = "uploading";
        item.lastAttempt = new Date().toISOString();
        item.attempts = (item.attempts || 0) + 1;
        renewUploadLease(item);
        await putSession(item);
        if (statusWriter) {
          statusWriter(
            "Uploading " + item.kind + " (" + formatBytes(item.blobSize || 0) + ")…"
          );
        }
        await fileItem(item, statusWriter);
        item.status = "done";
        item.leaseUntil = null;
        if (item.kind === "corrective") {
          // Keep a compact exact-capture receipt even when localStorage is
          // unavailable. Binary media is released only by this atomic write.
          await putSession({
            id: item.id, kind: item.kind, status: "done", phase: item.phase,
            date: item.date, vRef: item.vRef, assignmentId: item.assignmentId,
            attemptId: item.attemptId, seal: item.seal, sealed_at: item.sealed_at,
            video_sha256: item.video_sha256, code: item.code,
            sealPersisted: item.sealPersisted === true
          });
        } else {
          await putSession(item);
          await remove(item.id);
        }
        outcomes.push({ id: item.id, ok: true, phase: item.phase || "complete", attestationSeal: item.seal || "" });
      } catch (e) {
        item.status = "error";
        item.leaseUntil = null;
        item.lastError = e.message || String(e);
        item.nextRetry = new Date(Date.now() + Math.min(300000, 5000 * item.attempts)).toISOString();
        if (e.offset != null) item.uploadOffset = e.offset;
        await putSession(item);
        outcomes.push({ id: item.id, ok: false, error: item.lastError });
        if (statusWriter) statusWriter("Upload error: " + item.lastError);
      }
    }
    return outcomes;
  }

  async function fileItem(item, statusWriter) {
    if (item.kind === "corrective" && !hasCurrentCorrectiveIdentity(item)) {
      throw new Error("Corrective capture lacks the current assignment and attempt identity; record a new attempt.");
    }
    // Rebuild blob from stored ArrayBuffer if needed
    var blob = item.blob;
    if (!blob && item.blobBuffer) {
      blob = new Blob([item.blobBuffer], { type: item.mime || "video/webm" });
    }
    if (!blob) throw new Error("No blob in queue item");

    // Every take ships to the AP's Google Drive as a BACKUP copy — for corrective
    // sessions the public YouTube posting remains evidence submitted for AP
    // review; this copy is disaster recovery only.
    var up = await driveRelayUpload(item, blob, statusWriter);
    item.publicUrl = (up && (up.url || up.publicUrl)) || item.publicUrl || "";
    if (!MRB.config.get().demoMode && !item.publicUrl) {
      throw new Error("Private video backup URL is unavailable");
    }
    item.phase = "video-uploaded";
    await putSession(item);
    // Evidence original → R2; playback copy → Cloudflare Stream. Both are
    // best-effort here: a failure is logged on the item and retried on the
    // next queue pass, but never blocks the filing (Drive already has a copy).
    if (!MRB.config.get().demoMode && (!item.r2Key || !item.streamUid)) {
      try { await mediaShip(item, blob, statusWriter); } catch (e) { item.mediaError = String(e && e.message || e); await putSession(item); }
    }

    var attestBody = {
      date: item.date,
      day: item.day,
      kind: item.kind,
      code: item.code,
      video_sha256: item.video_sha256,
      chunk_chain: item.chunk_chain,
      chunk_count: item.chunk_count,
      stream_uid: item.streamUid || "",
      r2_key: item.r2Key || "",
    };
    if (item.weight != null) attestBody.weight = item.weight;
    if (item.photo_sha256s) attestBody.photo_sha256s = item.photo_sha256s;
    if (item.kind === "corrective") {
      attestBody.ref = item.vRef;
      attestBody.assignment_id = item.assignmentId;
      attestBody.attempt_id = item.attemptId;
    }

    if (!item.seal) {
      item.phase = "attesting";
      await putSession(item);
      var seal = await MRB.api.attest(attestBody);
      item.seal = seal.seal;
      item.sealed_at = seal.sealed_at;
      item.phase = "attested";
      await putSession(item);
    }
    item.sealPersisted = rememberFilingSeal(item);
    var filedUrl = item.publicUrl;
    item.phase = "filing";
    await putSession(item);

    if (item.kind === "daily" && item.photos) {
      for (var p = 0; p < item.photos.length; p++) {
        var ph = item.photos[p];
        await MRB.api.packet({
          date: item.date,
          name: ph.name,
          image_b64: ph.b64,
          weight: p === 0 ? item.weight : undefined,
          attestation_seal: item.seal,
          finalize: false,
        });
      }
      await MRB.api.packet({
        date: item.date,
        weight: item.weight,
        video_url: filedUrl,
        duration_sec: item.durationSec,
        stream_uid: item.streamUid || "",
        r2_key: item.r2Key || "",
        attestation_seal: item.seal,
        finalize: true,
      });
    } else if (item.kind === "weekly") {
      await MRB.api.weeklyfiled({
        date: item.date,
        day: item.day,
        week: item.week,
        documented: item.documented,
        required: item.required,
        weight: item.weight,
        open: item.openCount,
        url: filedUrl,
        attestation_seal: item.seal,
      });
    } else if (item.kind === "confirmation") {
      // Record the accepted capture as a pending confirmation before the
      // result screen later files its canonical public YouTube URL.
      await MRB.api.confirmationfiled({
        date: item.date,
        day: item.day,
        version: item.version,
        attestation_seal: item.seal,
      });
    } else if (item.kind === "corrective") {
      // Backup uploaded above; nothing filed to the record yet. Posting the
      // take to YouTube and filing the link on the result screen submits it
      // for AP verification (correctivefiled).
    } else {
      // demo — the attestation is enough
    }

    item.phase = item.kind === "corrective" || item.kind === "confirmation" || item.kind === "announcement"
      ? "private-backup-sealed"
      : item.kind === "demo" ? "demo-complete" : "filed";
    await putSession(item);
    if (statusWriter) {
      statusWriter(item.kind === "corrective"
        ? "Private backup sealed; public link filing remains pending."
        : item.kind === "confirmation"
          ? "Participant statement sealed; public link filing remains pending."
        : item.kind === "announcement"
          ? "Announcement capture sealed; public link filing remains pending."
          : item.kind === "demo" ? "Demo capture complete; nothing filed."
            : "Filed and sealed.");
    }
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
    filingSealKey: filingSealKey,
    rememberFilingSeal: rememberFilingSeal,
  };
})(window.MRB);
