/**
 * MRB Recording Assistant — namespace bootstrap
 * All modules attach to window.MRB. Classic script; no imports.
 */
(function (global) {
  "use strict";
  var MRB = global.MRB || {};
  MRB.VERSION = "1.0.0";
  MRB._ready = false;
  global.MRB = MRB;
})(typeof window !== "undefined" ? window : globalThis);
