/* Resumable upload queue backed by IndexedDB.
   Parts and their state survive a page reload until the server confirms the
   whole component. Upload-only: the server rejects overwrites, so replaying a
   part is safe. */
(function (global) {
  'use strict';

  const DB_NAME = 'ra-upload-queue';
  const STORE = 'parts';
  const PART_BYTES = 5 * 1024 * 1024;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('component', 'component', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function partId(sessionId, kind, part) {
    return sessionId + '|' + kind + '|' + part;
  }

  // Break a blob into 5 MB parts and persist them, along with the metadata
  // needed to finish the upload after a reload.
  async function enqueue(descriptor, blob) {
    const db = await openDb();
    const total = Math.max(1, Math.ceil(blob.size / PART_BYTES));
    const componentKey = descriptor.session_id + '|' + descriptor.component_kind;
    await new Promise((resolve, reject) => {
      const store = tx(db, 'readwrite');
      for (let i = 0; i < total; i++) {
        const part = i + 1;
        store.put({
          id: partId(descriptor.session_id, descriptor.component_kind, part),
          component: componentKey,
          session_id: descriptor.session_id,
          component_kind: descriptor.component_kind,
          upload_token: descriptor.upload_token,
          part: part,
          total: total,
          mime: blob.type || 'application/octet-stream',
          confirmed: false,
          blob: blob.slice(i * PART_BYTES, Math.min(blob.size, (i + 1) * PART_BYTES)),
        });
      }
      const txn = store.transaction;
      txn.oncomplete = resolve;
      txn.onerror = () => reject(txn.error);
    });
    db.close();
    return total;
  }

  async function pendingComponents() {
    const db = await openDb();
    const all = await new Promise((resolve, reject) => {
      const req = tx(db, 'readonly').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const byComponent = new Map();
    for (const row of all) {
      if (!byComponent.has(row.component)) {
        byComponent.set(row.component, {
          session_id: row.session_id,
          component_kind: row.component_kind,
          upload_token: row.upload_token,
          total: row.total,
          parts: [],
        });
      }
      byComponent.get(row.component).parts.push(row);
    }
    return Array.from(byComponent.values());
  }

  async function markConfirmed(sessionId, kind, part) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const store = tx(db, 'readwrite');
      const id = partId(sessionId, kind, part);
      const get = store.get(id);
      get.onsuccess = () => {
        const row = get.result;
        if (row) { row.confirmed = true; store.put(row); }
      };
      const txn = store.transaction;
      txn.oncomplete = resolve;
      txn.onerror = () => reject(txn.error);
    });
    db.close();
  }

  async function clearComponent(sessionId, kind) {
    const db = await openDb();
    const componentKey = sessionId + '|' + kind;
    await new Promise((resolve, reject) => {
      const store = tx(db, 'readwrite');
      const index = store.index('component');
      const cursorReq = index.openCursor(IDBKeyRange.only(componentKey));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      const txn = store.transaction;
      txn.oncomplete = resolve;
      txn.onerror = () => reject(txn.error);
    });
    db.close();
  }

  // Upload every unconfirmed part of a component with retry + backoff, then
  // call /complete. Survives reloads because state lives in IndexedDB.
  async function flushComponent(base, headers, component, onProgress) {
    // Ask the server what it already has so a reload doesn't re-send parts.
    let serverParts = [];
    try {
      const url = base + '/api/recording/upload?session=' + encodeURIComponent(component.session_id) +
        '&component=' + encodeURIComponent(component.component_kind);
      const r = await fetch(url, { headers: Object.assign({ 'x-session-token': component.upload_token }, headers) });
      if (r.ok) serverParts = (await r.json()).received_parts || [];
    } catch (e) { /* offline — fall through, retries handle it */ }

    const parts = component.parts.slice().sort((a, b) => a.part - b.part);
    for (const row of parts) {
      if (row.confirmed || serverParts.includes(row.part)) {
        await markConfirmed(component.session_id, component.component_kind, row.part);
        continue;
      }
      await putWithBackoff(base, headers, component, row);
      await markConfirmed(component.session_id, component.component_kind, row.part);
      if (onProgress) onProgress(row.part, component.total);
    }

    const completeUrl = base + '/api/recording/upload/complete';
    await postWithBackoff(completeUrl, headers, {
      session_id: component.session_id,
      upload_token: component.upload_token,
      component_kind: component.component_kind,
      total_parts: component.total,
    });
    await clearComponent(component.session_id, component.component_kind);
  }

  async function putWithBackoff(base, headers, component, row) {
    const url = base + '/api/recording/upload?session=' + encodeURIComponent(component.session_id) +
      '&component=' + encodeURIComponent(component.component_kind) +
      '&part=' + row.part + '&of=' + component.total;
    let delay = 2000;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await fetch(url, {
          method: 'PUT',
          headers: Object.assign({ 'x-session-token': component.upload_token, 'Content-Type': row.mime }, headers),
          body: row.blob,
        });
        if (r.ok) return;
        if (r.status >= 400 && r.status < 500 && r.status !== 429) throw new Error('upload rejected: ' + r.status);
      } catch (e) {
        if (attempt === 5) throw e;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 32000);
    }
  }

  async function postWithBackoff(url, headers, body) {
    let delay = 2000;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify(body),
        });
        if (r.ok) return await r.json();
        const j = await r.json().catch(() => ({}));
        if (j.error === 'missing_parts') throw new Error('missing parts: ' + (j.missing || []).join(','));
        if (r.status >= 400 && r.status < 500 && r.status !== 429) throw new Error('complete rejected: ' + r.status);
      } catch (e) {
        if (attempt === 5) throw e;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 32000);
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  global.RAUploadQueue = { enqueue, pendingComponents, flushComponent, clearComponent, PART_BYTES };
})(window);
