(function (MRB) {
  "use strict";

  var active = null;
  /** Minimum setup hold before Ready can start recording (seconds). */
  var SETUP_MIN_SEC = 8;
  /** Auto-start after this many seconds if still in setup. */
  var SETUP_MAX_SEC = 45;

  function setMeta(text) {
    var el = MRB.ui.byId("session-meta");
    if (el) el.textContent = text || "";
  }

  function overlayStateFrom(session) {
    var tag =
      session.type === "demo"
        ? MRB.overlay.demoTag()
        : MRB.config.SESSION_TAGS[session.type] || session.type.toUpperCase();

    if (session.inSetup) {
      tag = "SETUP · " + tag;
    }

    var bottomPrimary = "";
    if (session.inSetup) {
      bottomPrimary = "SETUP — WAIT POSITION · CODE " + session.code;
    } else if (session.type === "daily") {
      bottomPrimary = MRB.overlay.buildDailyBottom(session.day, session.code, session.weight);
    } else if (session.type === "corrective") {
      bottomPrimary = MRB.overlay.buildCornerBottom(
        session.vNum || session.level,
        session.level,
        MRB.dates.formatMmSs(session.remainingSec || 0)
      );
    } else if (session.type === "weekly") {
      bottomPrimary = "WEEK " + (session.week || "") + " · CODE " + session.code;
    } else if (session.type === "confirmation") {
      bottomPrimary = "VERSION " + (session.version || "1") + " · CODE " + session.code;
    } else {
      bottomPrimary = "CODE " + session.code;
    }

    return {
      sessionTag: tag,
      name: "MICHEAL RAY BERRY",
      projectLine: "PUBLIC ACCOUNTABILITY PROJECT",
      bottomPrimary: bottomPrimary,
      bottomSecondary: MRB.overlay.buildSecondary(session.date),
      // Burned-in pose line: tracks the CURRENT scripted position. Gray —
      // instructional, not computer-confirmed (pose monitor disabled).
      monitorText: session.poseText || null,
      monitorTone: session.poseTone || "ok",
      videoEl: session.videoEl,
      showGuides: !!session.inSetup,
    };
  }

  function titleCardStateFrom(session) {
    var title =
      session.type === "demo"
        ? MRB.overlay.demoTag()
        : MRB.config.SESSION_TAGS[session.type] || session.type.toUpperCase();
    var dateStr = MRB.dates.formatOverlayDate(session.date);
    var line1 = dateStr;
    var stat = "";
    if (session.type === "daily") {
      line1 = "DAY " + MRB.dates.padDay(session.day) + " \u00B7 " + dateStr;
      stat = session.weight ? session.weight + " LB" : "";
    } else if (session.type === "corrective") {
      line1 = "V-" + String(session.vNum || session.level).padStart(3, "0") + " \u00B7 LEVEL " + session.level + " \u00B7 " + dateStr;
    } else if (session.type === "weekly") {
      line1 = "WEEK " + (session.week || "") + " \u00B7 " + dateStr;
    } else if (session.type === "confirmation") {
      line1 = "VERSION " + (session.version || "1") + " \u00B7 " + dateStr;
    }
    return {
      name: "MICHEAL RAY BERRY",
      projectLine: "PUBLIC ACCOUNTABILITY PROJECT",
      title: title,
      stat: stat,
      line1: line1,
      line2: "MICHEALRAYBERRY.COM",
    };
  }

  function thumbStateFrom(session) {
    // The exported PNG is the exact composed frame (stamp burned in), so the
    // same frame is pickable as the thumbnail inside the YouTube video.
    return { frame: session.thumbFrame };
  }

  function makeDraw(session, compose, preview) {
    return function () {
      var ctx = compose.getContext("2d");
      if (session.titleCardUntil && performance.now() < session.titleCardUntil) {
        MRB.overlay.drawTitleCard(ctx, titleCardStateFrom(session));
      } else {
        var st = overlayStateFrom(session);
        MRB.overlay.drawOverlay(ctx, st);
        // Thumbnail still: one dedicated stamped capture from the opening
        // Wait hold (feet together, hands behind back), taken ~4.5s after the
        // title card so he is settled — every day's thumbnail shows the same
        // pose, camera position, and burned-in stamp.
        if (!session.thumbFrame && session.titleCardUntil && performance.now() > session.titleCardUntil + 4500 && String(session.poseText || "").indexOf("WAIT") === 0 && st.videoEl && st.videoEl.videoWidth) {
          var f = document.createElement("canvas");
          f.width = MRB.overlay.W;
          f.height = MRB.overlay.H;
          f.getContext("2d").drawImage(compose, 0, 0);
          session.thumbFrame = f;
        }
      }
      var pctx = preview.getContext("2d");
      pctx.drawImage(compose, 0, 0);
    };
  }

  async function sleep(ms, session) {
    var end = performance.now() + ms;
    while (performance.now() < end) {
      if (session.aborted) return;
      await new Promise(function (r) {
        setTimeout(r, 100);
      });
      if (!session.inSetup && (session.type === "corrective" || session.type === "weekly")) {
        session.remainingSec = Math.max(0, (session.endsAt - performance.now()) / 1000);
      }
    }
  }

  async function speakAndHold(session, text, minSec) {
    var start = performance.now();
    try {
      await MRB.audio.speak(text);
      MRB.audio.markAudioPresent();
    } catch (e) {
      MRB.ui.setStatus("session", "Voice error: " + e.message);
    }
    var elapsed = (performance.now() - start) / 1000;
    if (minSec && elapsed < minSec) {
      await sleep((minSec - elapsed) * 1000, session);
    }
  }

  /**
   * Setup phase: camera + overlay, NOT recording.
   * Get into position (hands behind head — voice only; pose monitor off).
   */
  async function runSetup(session, captureVideo, compose, preview) {
    session.inSetup = true;
    var setupEl = MRB.ui.byId("setup-controls");
    var readyBtn = MRB.ui.byId("btn-setup-ready");
    var countdownEl = MRB.ui.byId("setup-countdown");
    if (setupEl) setupEl.hidden = false;
    if (readyBtn) {
      readyBtn.disabled = true;
      readyBtn.textContent = "Ready — start recording";
    }

    var draw = makeDraw(session, compose, preview);
    var loop = MRB.frameLoop.create({
      canvas: compose,
      draw: draw,
    });
    loop.start();

    MRB.ui.setStatus("session", "SETUP — get into position");
    session.poseText = "WAIT POSITION";
    setMeta("Not recording yet · wait position");

    await speakAndHold(
      session,
      "Setup. This is not yet the recording. Get fully into frame in Wait position: feet together, hands behind the back. " +
        "Full project uniform visible. When recording begins you will move to Inspection: " +
        "feet shoulder-width apart, hands behind the head. " +
        "When you are set, press Ready, or wait for the countdown.",
      6
    );

    var started = performance.now();
    var resolved = false;
    var userReady = false;

    function onReady() {
      if (readyBtn && readyBtn.disabled) return;
      userReady = true;
    }
    if (readyBtn) {
      readyBtn.onclick = onReady;
    }

    while (!resolved && !session.aborted) {
      var elapsed = (performance.now() - started) / 1000;
      var remaining = Math.max(0, SETUP_MAX_SEC - elapsed);
      var canReady = elapsed >= SETUP_MIN_SEC;

      if (readyBtn) readyBtn.disabled = !canReady;
      if (countdownEl) {
        countdownEl.textContent =
          "SETUP " +
          Math.ceil(remaining) +
          "s · wait position" +
          (canReady ? " · ready available" : " · hold " + Math.ceil(SETUP_MIN_SEC - elapsed) + "s");
      }
      setMeta("Setup " + Math.floor(elapsed) + "s · wait position");

      if (canReady && userReady) {
        resolved = true;
        break;
      }
      // Auto-start after min + 4s if user does not press Ready
      if (canReady && elapsed >= SETUP_MIN_SEC + 4) {
        resolved = true;
        break;
      }
      if (elapsed >= SETUP_MAX_SEC) {
        resolved = true;
        break;
      }
      await sleep(200, session);
    }

    if (readyBtn) readyBtn.onclick = null;
    if (setupEl) setupEl.hidden = true;
    loop.stop();
    session.inSetup = false;

    if (session.aborted) return false;

    await speakAndHold(session, "Position set. Recording begins now. Hold.", 2);
    return true;
  }

  async function runSession(opts) {
    if (active) throw new Error("A session is already active");

    var session = {
      type: opts.type,
      machine: MRB.stateMachine.create(opts.type),
      day: opts.day,
      date: opts.date,
      code: opts.code,
      weight: opts.weight,
      level: opts.level || 1,
      minutes: opts.minutes || 10,
      version: opts.version || "1",
      week: opts.week || 1,
      vNum: opts.vNum || 1,
      violation: opts.violation || "",
      violationDate: opts.violationDate || opts.date,
      record: opts.record,
      figures: opts.figures,
      aborted: false,
      discard: false,
      remainingSec: 0,
      endsAt: 0,
      videoEl: null,
      failedView: null,
      photos: [],
      inSetup: false,
    };
    active = session;
    session.machine.go("preflight");
    session.machine.go("recording");

    var compose = MRB.ui.byId("compose-canvas");
    var preview = MRB.ui.byId("preview-canvas");
    var captureVideo = MRB.ui.byId("capture-video");
    session.videoEl = captureVideo;

    MRB.ui.showView("session");
    MRB.ui.setStatus("session", "Starting…");
    setMeta(session.type + " · code " + session.code);

    if (MRB.wake && MRB.wake.lockPortrait) {
      var ol = await MRB.wake.lockPortrait();
      if (!ol.ok) {
        /* desktop / unsupported — preflight already requires portrait on phones */
      }
    }

    if (MRB.wake) {
      var wl = await MRB.wake.acquire();
      if (!wl.ok) {
        MRB.ui.setStatus(
          "session",
          "Wake lock not held: " + (wl.message || "") + " — keep screen on"
        );
      }
    }

    MRB.audio.resetAudioEvidence();
    await MRB.audio.ensureRunning();
    await MRB.camera.start(captureVideo);

    var setupOk = await runSetup(session, captureVideo, compose, preview);
    if (!setupOk || session.aborted) {
      await cleanup(session, true);
      active = null;
      return { outcome: "error", error: "Setup aborted" };
    }

    var rec = MRB.recorder.create({
      canvas: compose,
      challengeCode: session.code,
    });

    // First ~1.6s of every recording is the burned-in title card — it is the
    // pick-a-frame thumbnail on Shorts and self-identifies any repost.
    session.titleCardUntil = performance.now() + 1600;
    var draw = makeDraw(session, compose, preview);
    await rec.start(draw);
    MRB.ui.setStatus("session", "Recording");
    setMeta(session.type + " · code " + session.code);

    try {
      if (session.type === "daily") {
        await runDaily(session);
      } else if (session.type === "corrective") {
        await runCorner(session);
      } else if (session.type === "weekly") {
        await runWeekly(session);
      } else if (session.type === "confirmation") {
        await runConfirmation(session);
      } else if (session.type === "announcement") {
        await runAnnouncement(session);
      } else {
        await runDemo(session);
      }
    } catch (e) {
      throw e;
    }

    MRB.audio.stop();
    var result = await rec.stop();

    if (session.discard) {
      session.machine.go("invalidated");
      await cleanup(session, true);
      active = null;
      return {
        outcome: "invalidated",
        reason: session.abortReason || "invalidated",
        discard: true,
      };
    }


    try {
      rec.assertPlausibleSize(result);
    } catch (e) {
      await cleanup(session, true);
      active = null;
      return { outcome: "error", error: e.message };
    }

    if (session.type === "daily") {
      session.machine.go("photos");
      await runPhotos(session, compose, captureVideo);
    }

    session.machine.go("filing");
    var filedOk = await fileResult(session, result, {});
    var links = await autoDownload(session, result);
    active = null;
    await cleanup(session, false);
    return {
      outcome: "complete",
      filed: filedOk,
      result: result,
      photos: session.photos,
      downloads: links,
    };
  }

  async function autoDownload(session, result) {
    if (!MRB.download || !result || !result.blob) return [];
    var thumbBlob = null;
    try {
      thumbBlob = await MRB.download.renderThumbnail(session.thumbFrame ? thumbStateFrom(session) : titleCardStateFrom(session));
    } catch (e) {
      /* thumbnail is a bonus artifact — never block the downloads */
    }
    return MRB.download.saveArtifacts({
      videoBlob: result.blob,
      photos: session.photos,
      thumbBlob: thumbBlob,
      meta: {
        kind: session.type,
        day: session.day,
        date: session.date,
        code: session.code,
        mime: result.mime,
      },
    });
  }

  async function runDaily(session) {
    // Official sequence: WAIT → INSPECTION → LEFT → REAR → RIGHT → FRONT → WAIT
    var views = [
      "wait_open",
      "inspection",
      "left",
      "rear",
      "right",
      "front_close",
      "wait_close",
    ];
    var segments = MRB.scripts.dailySegments({
      day: session.day,
      date: session.date,
      weight: session.weight,
    });

    for (var i = 0; i < segments.length; i++) {
      if (session.aborted) break;
      var viewId = segments[i].id || views[i];
      if (viewId) {
        session.machine.setCurrentView(viewId);
      }
      MRB.ui.setStatus("session", segments[i].label);
      if (segments[i].pose) session.poseText = segments[i].pose;
      await speakAndHold(session, segments[i].text, segments[i].sec);
      if (viewId) session.machine.markViewDone(viewId);
    }
  }

  async function runCorner(session) {
    // WAIT → CORNER (level timer) → WAIT
    var totalSec = session.minutes * 60;
    session.remainingSec = totalSec;

    var segments = MRB.scripts.cornerSegments({
      level: session.level,
      minutes: session.minutes,
      violation: session.violation,
      violationDate: session.violationDate,
      date: session.date,
    });

    for (var i = 0; i < segments.length; i++) {
      if (session.aborted) return;
      var seg = segments[i];
      if (seg.id) session.machine.setCurrentView(seg.id);
      MRB.ui.setStatus("session", seg.label);
      if (seg.pose) session.poseText = seg.pose;
      setMeta(
        "Level " +
          session.level +
          " · " +
          seg.label +
          " · Corrective Session"
      );
      await speakAndHold(session, seg.text, seg.sec);
      if (seg.id) session.machine.markViewDone(seg.id);
    }

    if (session.aborted) return;

    session.endsAt = performance.now() + totalSec * 1000;
    session.remainingSec = totalSec;
    MRB.ui.setStatus("session", "Corner Position — hold");
    session.machine.setCurrentView("corner_hold");

    var marks = MRB.scripts.cornerHoldMarks(session.level);
    var fired = {};

    while (session.remainingSec > 0 && !session.aborted) {
      session.remainingSec = Math.max(0, (session.endsAt - performance.now()) / 1000);
      setMeta(
        "Level " +
          session.level +
          " · " +
          MRB.dates.formatMmSs(session.remainingSec) +
          " · Corner Position"
      );

      var rem = session.remainingSec;
      for (var mi = 0; mi < marks.length; mi++) {
        var mark = marks[mi];
        var key = String(mark.atSec);
        if (!fired[key] && rem <= mark.atSec && rem > mark.atSec - 2.5) {
          fired[key] = true;
          MRB.audio.speak(mark.text).catch(function () {});
        }
      }

      await sleep(250, session);
    }

    if (session.aborted) return;

    session.remainingSec = 0;
    MRB.ui.setStatus("session", "Timer complete");
    session.poseText = "RETURN TO WAIT";
    await speakAndHold(session, MRB.scripts.cornerTimerComplete(), 10);
    if (session.aborted) return;

    session.machine.setCurrentView("wait_close");
    MRB.ui.setStatus("session", "Closing — Wait");
    session.poseText = "WAIT POSITION";
    await speakAndHold(session, MRB.scripts.cornerClosing(session), 14);
    session.machine.markViewDone("wait_close");
  }

  async function runWeekly(session) {
    var totalSec = 10 * 60;
    session.remainingSec = totalSec;
    var fig = session.figures || { lines: [], assessment: "", endW: null, documented: 0 };

    MRB.ui.setStatus("session", "Opening");
    session.poseText = "FACE CAMERA · HANDS BEHIND HEAD";
    await speakAndHold(session, MRB.scripts.weeklyOpening(session), 12);
    if (session.aborted) return;

    for (var i = 0; i < (fig.lines || []).length; i++) {
      if (session.aborted) return;
      await speakAndHold(session, fig.lines[i], 4);
    }

    MRB.ui.setStatus("session", "To the corner");
    session.poseText = "CORNER POSITION · HANDS BEHIND HEAD";
    await speakAndHold(session, MRB.scripts.weeklyToCorner(), 14);
    if (session.aborted) return;

    session.endsAt = performance.now() + totalSec * 1000;

    var halfFired = false;
    var assessFired = false;
    while (session.remainingSec > 0 && !session.aborted) {
      session.remainingSec = Math.max(0, (session.endsAt - performance.now()) / 1000);
      setMeta("Weekly · " + MRB.dates.formatMmSs(session.remainingSec) + " · hands behind head");

      if (!assessFired && session.remainingSec < totalSec - 30) {
        assessFired = true;
        MRB.audio
          .speak(fig.assessment || MRB.scripts.weeklyAssessment(fig.documented))
          .catch(function () {});
      }
      if (!halfFired && session.remainingSec <= totalSec / 2) {
        halfFired = true;
        MRB.audio.speak(MRB.scripts.weeklyWeightMid(fig.endW)).catch(function () {});
      }
      await sleep(250, session);
    }

    MRB.ui.setStatus("session", "Closing");
    session.poseText = "FACE CAMERA · HANDS BEHIND HEAD";
    await speakAndHold(
      session,
      MRB.scripts.weeklyClosing({
        week: session.week,
        summaryLine: "Documented " + (fig.documented || 0) + " of 7.",
      }),
      12
    );
  }

  async function runConfirmation(session) {
    MRB.ui.setStatus("session", "Confirmation");
    session.poseText = "FACE CAMERA · HANDS BEHIND HEAD";
    await speakAndHold(session, MRB.scripts.confirmationScript(session), 30);
  }

  async function runDemo(session) {
    MRB.ui.setStatus("session", "Demonstration");
    session.poseText = "FACE CAMERA · HANDS BEHIND HEAD";
    await speakAndHold(session, MRB.scripts.demoScript(), 25);
  }

  async function runAnnouncement(session) {
    MRB.ui.setStatus("session", "Announcement");
    session.poseText = "WAIT POSITION";
    await speakAndHold(session, MRB.scripts.announcementScript(), 60);
  }

  async function capturePhotoBlob(photoCanvas, videoEl, session) {
    var state = overlayStateFrom(session);
    state.videoEl = videoEl;
    MRB.overlay.drawOverlay(photoCanvas.getContext("2d"), state);
    return new Promise(function (resolve, reject) {
      photoCanvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error("Photo capture failed"));
            return;
          }
          resolve(blob);
        },
        "image/jpeg",
        0.92
      );
    });
  }

  /**
   * Four accountability photographs — auto-captured after prompt + hold.
   * No shutter required.
   */
  async function runPhotos(session, compose, videoEl) {
    MRB.ui.showView("photos");
    var prompts = MRB.scripts.photoPrompts();
    var photoCanvas = MRB.ui.byId("photo-canvas");
    var shutter = MRB.ui.byId("btn-photo-shutter");
    if (shutter) {
      shutter.disabled = true;
      shutter.hidden = true;
    }

    var HOLD_SEC = 3;

    for (var i = 0; i < prompts.length; i++) {
      if (session.aborted) break;
      var p = prompts[i];
      MRB.ui.byId("photo-step-label").textContent = p.label + " (" + (i + 1) + "/4)";
      MRB.ui.byId("photo-prompt").textContent = p.text;
      MRB.ui.setStatus("photo", "Preparing…");
      session.poseText = p.pose || "HANDS BEHIND HEAD";

      var live = true;
      var liveTimer = setInterval(function () {
        if (!live) return;
        var state = overlayStateFrom(session);
        state.videoEl = videoEl;
        MRB.overlay.drawOverlay(photoCanvas.getContext("2d"), state);
      }, 100);

      await MRB.audio.speak(p.text).catch(function () {});
      if (session.aborted) {
        live = false;
        clearInterval(liveTimer);
        break;
      }

      // Auto countdown then capture
      for (var c = HOLD_SEC; c >= 1; c--) {
        if (session.aborted) break;
        MRB.ui.setStatus(
          "photo",
          "Auto capture in " + c + " · hold position"
        );
        await sleep(1000, session);
      }

      if (session.aborted) {
        live = false;
        clearInterval(liveTimer);
        break;
      }

      live = false;
      clearInterval(liveTimer);
      MRB.ui.setStatus("photo", "Capturing " + p.label + "…");

      try {
        var blob = await capturePhotoBlob(photoCanvas, videoEl, session);
        var buf = await blob.arrayBuffer();
        var hex = await MRB.crypto.sha256Hex(buf);
        session.photos.push({
          id: p.id,
          name: "micheal-ray-berry-day-" + String(session.day).padStart(3, "0") + "-" + p.id + "-" + session.date + ".jpg",
          blob: blob,
          sha256: hex,
        });
        MRB.ui.setStatus("photo", "Captured " + p.label + " (" + (i + 1) + "/4)");
      } catch (e) {
        MRB.ui.setStatus("photo", "Capture failed: " + (e.message || e));
      }

      await sleep(700, session);
    }

    if (shutter) shutter.hidden = true;
  }

  async function fileResult(session, result, flags) {
    flags = flags || {};
    var videoHash = await MRB.crypto.sha256Hex(await result.blob.arrayBuffer());
    var photoHashes = (session.photos || []).map(function (p) {
      return p.sha256;
    });

    var photosB64 = [];
    for (var i = 0; i < (session.photos || []).length; i++) {
      var ph = session.photos[i];
      var b64 = await blobToBase64(ph.blob);
      photosB64.push({ name: ph.name, b64: b64, sha256: ph.sha256 });
    }

    var item = {
      kind: MRB.config.KIND_MAP[session.type] || session.type,
      date: session.date,
      day: session.day,
      vNum: session.vNum,
      code: session.code,
      weight: session.weight,
      mime: result.mime || "video/webm",
      blob: result.blob,
      blobBuffer: await result.blob.arrayBuffer(),
      blobSize: result.size,
      video_sha256: videoHash,
      photo_sha256s: photoHashes.length ? photoHashes : undefined,
      photos: photosB64,
      chunk_chain: result.chunk_chain,
      chunk_count: result.chunk_count,
      week: session.week,
      version: session.version,
      documented: session.figures && session.figures.documented,
      required: 7,
      openCount: session.figures && session.figures.open ? session.figures.open.length : 0,
    };

    try {
      if (!navigator.onLine) throw new Error("offline");
      var queued = await MRB.queue.enqueue(item);
      await MRB.queue.processQueue(function (msg) {
        MRB.ui.setStatus("session", msg);
      });
      session.machine.go("complete");
      return { ok: true, id: queued.id, immediate: true };
    } catch (e) {
      await MRB.queue.enqueue(item);
      session.machine.go("queued");
      return { ok: true, queued: true, error: e.message };
    }
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || "");
        var idx = s.indexOf(",");
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function cleanup(session, dropCamera) {
    MRB.audio.stop();
    if (session && session.type !== "daily") {
      MRB.camera.stop();
    }
    if (dropCamera) MRB.camera.stop();
    var setupEl = MRB.ui.byId("setup-controls");
    if (setupEl) setupEl.hidden = true;
  }

  function getActive() {
    return active;
  }

  MRB.session = {
    run: runSession,
    getActive: getActive,
    overlayStateFrom: overlayStateFrom,
    SETUP_MIN_SEC: SETUP_MIN_SEC,
    SETUP_MAX_SEC: SETUP_MAX_SEC,
  };
})(window.MRB);
