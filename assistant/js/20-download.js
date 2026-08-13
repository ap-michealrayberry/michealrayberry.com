(function (MRB) {
  "use strict";

  /**
   * Field download: auto-save finished artifacts + keep a visible link.
   * Capture time is proven by the challenge code; local file is a working copy.
   */
  function triggerDownload(blob, filename) {
    if (!blob) return null;
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "mrb-capture.bin";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Keep object URL for the visible link; revoke later
    setTimeout(function () {
      try {
        document.body.removeChild(a);
      } catch (e) {
        /* ignore */
      }
    }, 0);
    return url;
  }

  function extensionForMime(mime) {
    mime = String(mime || "");
    if (mime.indexOf("mp4") >= 0) return "mp4";
    if (mime.indexOf("webm") >= 0) return "webm";
    if (mime.indexOf("jpeg") >= 0 || mime.indexOf("jpg") >= 0) return "jpg";
    if (mime.indexOf("png") >= 0) return "png";
    return "bin";
  }

  function buildVideoName(meta) {
    meta = meta || {};
    // Canonical grammar (matches the repo mirror, R2 keys, and Drive intake):
    //   micheal-ray-berry-day-NNN-<stem>-YYYY-MM-DD.<code>.ext
    var STEMS = { daily: "inspection", corrective: "corrective", weekly: "weekly-review", confirmation: "confirmation", demo: "demo" };
    var kind = meta.kind || meta.type || "session";
    var stem = STEMS[kind] || kind;
    var day = "day-" + String(meta.day != null ? meta.day : 0).padStart(3, "0");
    var date = meta.date || new Date().toISOString().slice(0, 10);
    var code = meta.code ? "." + meta.code : "";
    var ext = extensionForMime(meta.mime);
    return "micheal-ray-berry-" + day + "-" + stem + "-" + date + code + "." + ext;
  }

  function buildThumbName(meta) {
    meta = meta || {};
    var STEMS = { daily: "inspection", corrective: "corrective", weekly: "weekly-review", confirmation: "confirmation", demo: "demo" };
    var kind = meta.kind || meta.type || "session";
    var stem = STEMS[kind] || kind;
    var day = "day-" + String(meta.day != null ? meta.day : 0).padStart(3, "0");
    var date = meta.date || new Date().toISOString().slice(0, 10);
    return "micheal-ray-berry-" + day + "-" + stem + "-thumbnail-" + date + ".png";
  }

  /** Render the session title card to a vertical PNG (720\u00D71280). */
  function renderThumbnail(state) {
    return new Promise(function (resolve, reject) {
      var c = document.createElement("canvas");
      c.width = MRB.overlay.W;
      c.height = MRB.overlay.H;
      if (state && state.frame) MRB.overlay.drawThumbCard(c.getContext("2d"), state);
      else MRB.overlay.drawTitleCard(c.getContext("2d"), state);
      c.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("Thumbnail render failed"));
      }, "image/png");
    });
  }

  /**
   * Auto-download video + photos; return link descriptors for the result UI.
   */
  function saveArtifacts(payload) {
    payload = payload || {};
    var links = [];
    var meta = payload.meta || {};

    if (payload.videoBlob) {
      var vName = buildVideoName(
        Object.assign({}, meta, { mime: payload.videoBlob.type || meta.mime })
      );
      var vUrl = triggerDownload(payload.videoBlob, vName);
      links.push({
        kind: "video",
        name: vName,
        url: vUrl,
        size: payload.videoBlob.size,
        blob: payload.videoBlob,
      });
    }

    if (payload.thumbBlob) {
      var tName = buildThumbName(meta);
      var tUrl = triggerDownload(payload.thumbBlob, tName);
      links.push({
        kind: "thumbnail",
        name: tName,
        url: tUrl,
        size: payload.thumbBlob.size,
        blob: payload.thumbBlob,
      });
    }

    var photos = payload.photos || [];
    for (var i = 0; i < photos.length; i++) {
      var ph = photos[i];
      if (!ph || !ph.blob) continue;
      var pName = ph.name || "micheal-ray-berry-photo-" + (ph.id || i) + ".jpg";
      var pUrl = triggerDownload(ph.blob, pName);
      links.push({
        kind: "photo",
        name: pName,
        url: pUrl,
        size: ph.blob.size,
        blob: ph.blob,
      });
    }

    return links;
  }

  function renderLinks(container, links) {
    if (!container) return;
    container.innerHTML = "";
    if (!links || !links.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    var heading = document.createElement("div");
    heading.className = "section-label";
    heading.textContent = "Local copies (auto-downloaded)";
    container.appendChild(heading);

    links.forEach(function (link) {
      var row = document.createElement("div");
      row.className = "download-row";
      var a = document.createElement("a");
      a.href = link.url;
      a.download = link.name;
      a.className = "download-link mono";
      a.textContent =
        "Download " +
        link.name +
        (link.size ? " · " + MRB.queue.formatBytes(link.size) : "");
      row.appendChild(a);
      container.appendChild(row);
    });
  }

  MRB.download = {
    triggerDownload: triggerDownload,
    saveArtifacts: saveArtifacts,
    renderLinks: renderLinks,
    buildVideoName: buildVideoName,
    buildThumbName: buildThumbName,
    renderThumbnail: renderThumbnail,
    extensionForMime: extensionForMime,
  };
})(window.MRB);
