(function () {
  'use strict';

  var ATTESTATION_URL = '/data/attestations.json';
  var HASH_PATTERN = /^[a-f0-9]{64}$/;
  var input = document.getElementById('file-checker');
  var progress = document.getElementById('checking-status');
  var result = document.getElementById('check-result');
  var title = document.getElementById('result-title');
  var detail = document.getElementById('result-detail');
  var hashLine = document.getElementById('result-hash');

  function showProgress(message) {
    progress.textContent = message;
    progress.hidden = false;
    result.hidden = true;
  }

  function showResult(color, heading, message, hash) {
    progress.hidden = true;
    result.style.borderLeftColor = color;
    title.style.color = color;
    title.textContent = heading;
    detail.textContent = message;
    hashLine.textContent = hash ? 'SHA-256: ' + hash : '';
    result.hidden = false;
  }

  function acceptedRecords(payload) {
    if (!payload || payload.schema_version !== 1 || payload.available === false || !Array.isArray(payload.records)) {
      throw new Error('public attestation feed schema mismatch');
    }
    return payload.records.filter(function (row) {
      return row
        && row.event === 'capture-attested'
        && row.status === 'VALID'
        && (!row.video_sha256 || HASH_PATTERN.test(String(row.video_sha256).toLowerCase()))
        && Array.isArray(row.photo_sha256s)
        && row.photo_sha256s.every(function (value) {
          return HASH_PATTERN.test(String(value || '').toLowerCase());
        });
    });
  }

  async function compare(file) {
    input.disabled = true;
    showProgress('Computing SHA-256 locally…');
    var hash = '';
    try {
      var buffer = await file.arrayBuffer();
      var digest = await crypto.subtle.digest('SHA-256', buffer);
      hash = Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');

      showProgress('Searching the attestation log…');
      var response = await fetch(ATTESTATION_URL, { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error('public attestation feed unavailable');
      var records = acceptedRecords(await response.json());
      var hit = records.find(function (row) {
        var videoHash = String(row.video_sha256).toLowerCase();
        var photoHashes = row.photo_sha256s.map(function (value) { return String(value).toLowerCase(); });
        return videoHash === hash || photoHashes.indexOf(hash) !== -1;
      });

      if (hit) {
        showResult(
          '#8A6500',
          'HASH LISTED IN A VALID LOG ROW',
          'The public feed lists these exact bytes in an accepted capture-attested row for Day ' +
            String(hit.day || '?') + ' (' + String(hit.date || '') + '), received at ' +
            String(hit.received_at || 'an unlisted time') + '. This confirms a byte-for-byte hash match only; it does not independently prove capture time, authorship, or authenticity.',
          hash
        );
      } else {
        showResult(
          '#B3261E',
          'NOT FOUND IN THE LOG',
          'No accepted capture attestation matches this file byte-for-byte. Re-encoding, screenshots, and re-saving change the hash; if the file claims to be an original from the record, treat it as unverified and report it.',
          hash
        );
      }
    } catch (error) {
      showResult('#8A6500', 'CHECK FAILED', 'The browser could not compute the hash or read a valid public log. Try again with a connection.', hash);
    } finally {
      input.disabled = false;
    }
  }

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (file) compare(file);
  });
})();
