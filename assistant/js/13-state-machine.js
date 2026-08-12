(function (MRB) {
  "use strict";

  /**
   * Session state machine.
   * States: idle → preflight → recording → (photos) → filing → complete | invalidated
   *
   * Invariants:
   * - Invalidation discards full session (no partial corrective as shorter)
   * - Daily: failed view re-runs that view only
   */
  var TRANSITIONS = {
    idle: ["preflight"],
    preflight: ["recording", "idle"],
    recording: ["photos", "filing", "invalidated", "view_retry"],
    view_retry: ["recording", "invalidated"],
    photos: ["filing"],
    filing: ["complete", "queued"],
    complete: ["idle"],
    queued: ["idle"],
    invalidated: ["idle"],
  };

  function createMachine(sessionType) {
    var state = "idle";
    var history = [{ state: "idle", t: Date.now() }];
    var meta = {
      sessionType: sessionType,
      discard: false,
      failedView: null,
      viewsCompleted: [],
      currentView: null,
    };

    function can(to) {
      var allowed = TRANSITIONS[state] || [];
      return allowed.indexOf(to) >= 0;
    }

    function go(to, info) {
      if (!can(to)) {
        throw new Error("Invalid transition " + state + " → " + to);
      }
      var from = state;
      state = to;
      history.push({ state: to, from: from, t: Date.now(), info: info || null });

      if (to === "invalidated") {
        meta.discard = true;
      }
      if (to === "view_retry") {
        meta.failedView = (info && info.view) || meta.currentView;
      }
      return state;
    }

    function getState() {
      return state;
    }

    function getMeta() {
      return meta;
    }

    function getHistory() {
      return history.slice();
    }

    function assertInvalidationDiscards() {
      return meta.discard === true && state === "invalidated";
    }

    function assertViewRetryOnly(view) {
      return state === "view_retry" && meta.failedView === view;
    }

    return {
      go: go,
      can: can,
      getState: getState,
      getMeta: getMeta,
      getHistory: getHistory,
      assertInvalidationDiscards: assertInvalidationDiscards,
      assertViewRetryOnly: assertViewRetryOnly,
      setCurrentView: function (v) {
        meta.currentView = v;
      },
      markViewDone: function (v) {
        if (meta.viewsCompleted.indexOf(v) < 0) meta.viewsCompleted.push(v);
      },
    };
  }

  MRB.stateMachine = {
    create: createMachine,
    TRANSITIONS: TRANSITIONS,
  };
})(window.MRB);
