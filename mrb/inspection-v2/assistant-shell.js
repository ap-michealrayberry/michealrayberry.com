const ENDPOINT = 'https://script.google.com/macros/s/AKfycbyJ7PV4NAmK2WcP-pBMLW78orrw_i7KndnKEkWLT_Xd0GtyeRztQpOxd2oSaitEHJM7/exec';
const START_DATE = '2026-07-20';
const ENGINE_SRC = '../inspection/recording-assistant.js';
const KEY_SLOT = 'mrb_packet_key';
const LOG_LIMIT = 80;

const $ = (id) => document.getElementById(id);
const logEntries = [];
let verified = false;
let checksPassed = false;
let engineLoaded = false;
let cameraTestStream = null;

function isoTodayET() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function projectDay() {
  const today = new Date(`${isoTodayET()}T12:00:00-04:00`);
  const start = new Date(`${START_DATE}T12:00:00-04:00`);
  return Math.max(1, Math.floor((today - start) / 86400000) + 1);
}

function addLog(level, message, extra = '') {
  const item = {
    at: new Date().toISOString(),
    level,
    message: String(message),
    extra: extra ? String(extra).slice(0, 800) : '',
  };
  logEntries.push(item);
  if (logEntries.length > LOG_LIMIT) logEntries.shift();
  renderLog();
}

function renderLog() {
  $('errorLog').textContent = logEntries.map((x) =>
    `[${x.at}] ${x.level.toUpperCase()} ${x.message}${x.extra ? `\n${x.extra}` : ''}`
  ).join('\n\n') || 'No errors recorded.';
}

function setStatus(id, message, state = '') {
  const node = $(id);
  node.textContent = message;
  node.className = `statusline${state ? ` ${state}` : ''}`;
}

function setEngineState(label, state = '') {
  const node = $('engineState');
  node.textContent = label;
  node.className = `state-pill${state ? ` ${state}` : ''}`;
}

function showFallback(reason) {
  $('fallback').classList.add('open');
  setEngineState('Failed — fallback open', 'fail');
  addLog('error', reason);
}

function hideFallback() {
  $('fallback').classList.remove('open');
}

function getStoredKey() {
  try { return localStorage.getItem(KEY_SLOT) || ''; } catch { return ''; }
}

function storeKey(value) {
  try { localStorage.setItem(KEY_SLOT, value); } catch (error) {
    addLog('warn', 'Could not persist the device key', error.message);
  }
}

function removeStoredKey() {
  try { localStorage.removeItem(KEY_SLOT); } catch {}
}

async function checkStorage() {
  if (!navigator.storage?.estimate) return { state: 'warn', detail: 'Storage estimate unavailable' };
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    const free = Math.max(0, quota - usage);
    const freeMb = Math.round(free / 1048576);
    return freeMb >= 500
      ? { state: 'ok', detail: `${freeMb.toLocaleString()} MB estimated free` }
      : { state: 'warn', detail: `${freeMb.toLocaleString()} MB estimated free — clear space before recording` };
  } catch (error) {
    return { state: 'warn', detail: `Storage check failed: ${error.message}` };
  }
}

async function checkEndpoint() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`${ENDPOINT}?action=mystate&key=${encodeURIComponent(getStoredKey())}`, {
      cache: 'no-store', signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok
      ? { state: 'ok', detail: `Record endpoint reachable (${response.status})` }
      : { state: 'fail', detail: `Record endpoint returned ${response.status}` };
  } catch (error) {
    clearTimeout(timer);
    return { state: 'fail', detail: `Record endpoint unavailable: ${error.name === 'AbortError' ? 'timeout' : error.message}` };
  }
}

async function runChecks() {
  setStatus('preflightStatus', 'Running preflight…');
  const checks = [
    { name: 'Secure connection', result: location.protocol === 'https:' || location.hostname === 'localhost'
      ? { state: 'ok', detail: 'HTTPS active' }
      : { state: 'fail', detail: 'Camera access requires HTTPS' } },
    { name: 'Camera API', result: navigator.mediaDevices?.getUserMedia
      ? { state: 'ok', detail: 'getUserMedia available' }
      : { state: 'fail', detail: 'Camera API unavailable in this browser' } },
    { name: 'Recorder API', result: window.MediaRecorder && HTMLCanvasElement.prototype.captureStream
      ? { state: 'ok', detail: 'MediaRecorder + canvas capture available' }
      : { state: 'fail', detail: 'Required recording APIs are unavailable' } },
    { name: 'Crypto fingerprinting', result: crypto?.subtle
      ? { state: 'ok', detail: 'SHA-256 support available' }
      : { state: 'fail', detail: 'Web Crypto unavailable' } },
    { name: 'Network', result: navigator.onLine
      ? { state: 'ok', detail: 'Browser reports online' }
      : { state: 'fail', detail: 'Browser reports offline' } },
    { name: 'Local storage', result: (() => {
      try { localStorage.setItem('__ra_test', '1'); localStorage.removeItem('__ra_test'); return { state: 'ok', detail: 'Device settings can be stored' }; }
      catch { return { state: 'warn', detail: 'Private browsing may prevent settings storage' }; }
    })() },
    { name: 'Available storage', result: await checkStorage() },
    { name: 'Record service', result: await checkEndpoint() },
  ];

  $('checks').replaceChildren(...checks.map(({ name, result }) => {
    const row = document.createElement('div');
    row.className = `check ${result.state}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const strong = document.createElement('strong');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = result.detail;
    row.append(dot, strong, small);
    return row;
  }));

  const hardFailures = checks.filter((x) => x.result.state === 'fail');
  checksPassed = hardFailures.length === 0;
  if (checksPassed) {
    setStatus('preflightStatus', 'Preflight passed. Test the camera once before the real session.', 'ok');
  } else {
    setStatus('preflightStatus', `${hardFailures.length} blocking check${hardFailures.length === 1 ? '' : 's'} failed.`, 'error');
    addLog('error', 'Preflight failed', hardFailures.map((x) => `${x.name}: ${x.result.detail}`).join('; '));
  }
  maybeLoadEngine();
}

async function testCamera() {
  setStatus('preflightStatus', 'Requesting camera and microphone permission…');
  try {
    cameraTestStream?.getTracks().forEach((track) => track.stop());
    cameraTestStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: true,
    });
    const videoTrack = cameraTestStream.getVideoTracks()[0];
    const audioTrack = cameraTestStream.getAudioTracks()[0];
    setStatus('preflightStatus', `Camera ready: ${videoTrack?.label || 'available'}; microphone: ${audioTrack ? 'available' : 'not returned'}.`, audioTrack ? 'ok' : 'error');
    addLog('info', 'Camera test passed', `${videoTrack?.getSettings?.().width || '?'}x${videoTrack?.getSettings?.().height || '?'}; audio=${Boolean(audioTrack)}`);
  } catch (error) {
    setStatus('preflightStatus', `Camera test failed: ${error.message}`, 'error');
    addLog('error', 'Camera test failed', `${error.name}: ${error.message}`);
  } finally {
    setTimeout(() => {
      cameraTestStream?.getTracks().forEach((track) => track.stop());
      cameraTestStream = null;
    }, 1200);
  }
}

async function verifyKey() {
  const key = $('deviceKey').value.trim();
  if (!key) {
    setStatus('authStatus', 'Enter the device key.', 'error');
    return;
  }
  setStatus('authStatus', 'Verifying…');
  $('verifyKey').disabled = true;
  try {
    const response = await fetch(`${ENDPOINT}?action=mystate&key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!data?.ok) throw new Error(data?.error || 'Key not accepted');
    storeKey(key);
    verified = true;
    setStatus('authStatus', 'Device key verified.', 'ok');
    addLog('info', 'Device key verified');
    maybeLoadEngine();
  } catch (error) {
    verified = false;
    removeStoredKey();
    setStatus('authStatus', `Verification failed: ${error.message}`, 'error');
    addLog('error', 'Device key verification failed', error.message);
  } finally {
    $('verifyKey').disabled = false;
  }
}

function loadScript(src, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ra-engine="${src}"]`);
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.src = `${src}?v=${Date.now()}`;
    script.dataset.raEngine = src;
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Recording engine load timed out'));
    }, timeoutMs);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Recording engine script could not be loaded')); };
    document.head.appendChild(script);
  });
}

async function maybeLoadEngine(force = false) {
  if (!verified || !checksPassed || (engineLoaded && !force)) return;
  hideFallback();
  setEngineState('Loading…');
  const mount = $('assistantMount');
  mount.innerHTML = '<div class="empty">Loading the capture engine…</div>';
  try {
    if (force) {
      engineLoaded = false;
      mount.replaceChildren();
    }
    if (!customElements.get('recording-assistant')) await loadScript(ENGINE_SRC);
    if (!customElements.get('recording-assistant')) throw new Error('Script loaded but <recording-assistant> was not registered');
    const assistant = document.createElement('recording-assistant');
    mount.replaceChildren(assistant);
    engineLoaded = true;
    setEngineState('Ready', 'ok');
    addLog('info', 'Recording engine mounted');
  } catch (error) {
    engineLoaded = false;
    mount.innerHTML = '<div class="empty">The capture engine failed to start. Use the fallback below or retry.</div>';
    showFallback(error.message);
  }
}

function resetAssistant() {
  const confirmed = window.confirm('Reset saved recording-assistant settings on this device? This does not change the public record.');
  if (!confirmed) return;
  removeStoredKey();
  try {
    localStorage.removeItem('mrb_el_key');
    localStorage.removeItem('mrb_el_voice');
  } catch {}
  verified = false;
  engineLoaded = false;
  $('deviceKey').value = '';
  $('assistantMount').innerHTML = '<div class="empty">Assistant reset. Verify the device key and run preflight again.</div>';
  setStatus('authStatus', 'Saved assistant settings cleared.');
  setEngineState('Reset');
  addLog('info', 'Assistant settings reset');
}

function downloadDiagnostics() {
  const report = {
    generatedAt: new Date().toISOString(),
    page: location.href,
    projectDateET: isoTodayET(),
    projectDay: projectDay(),
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    language: navigator.language,
    screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio },
    apis: {
      mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      mediaRecorder: Boolean(window.MediaRecorder),
      canvasCaptureStream: Boolean(HTMLCanvasElement.prototype.captureStream),
      webCrypto: Boolean(crypto?.subtle),
      wakeLock: Boolean(navigator.wakeLock?.request),
    },
    verified,
    checksPassed,
    engineLoaded,
    logs: logEntries,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `recording-assistant-diagnostics-${isoTodayET()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

window.addEventListener('error', (event) => {
  addLog('error', event.message || 'Unhandled page error', `${event.filename || ''}:${event.lineno || ''}:${event.colno || ''}`);
  if (engineLoaded) showFallback('The recording engine raised an unhandled error.');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
  addLog('error', 'Unhandled promise rejection', reason);
  if (engineLoaded) showFallback('The recording engine raised an unhandled promise rejection.');
});

window.addEventListener('offline', () => {
  addLog('warn', 'Browser went offline');
  setStatus('preflightStatus', 'Connection lost. Do not start an attested session until online.', 'error');
});
window.addEventListener('online', () => {
  addLog('info', 'Browser is online');
  setStatus('preflightStatus', 'Connection restored. Run checks again.', 'ok');
});

document.addEventListener('visibilitychange', () => {
  addLog('info', `Page visibility: ${document.visibilityState}`);
});

$('runChecks').addEventListener('click', runChecks);
$('testCamera').addEventListener('click', testCamera);
$('verifyKey').addEventListener('click', verifyKey);
$('downloadDiag').addEventListener('click', downloadDiagnostics);
$('resetAssistant').addEventListener('click', resetAssistant);
$('retryEngine').addEventListener('click', () => maybeLoadEngine(true));
$('deviceKey').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') verifyKey();
});

$('headerDay').textContent = `Day ${projectDay()} · ${isoTodayET()} · Recording Assistant V2`;
const savedKey = getStoredKey();
if (savedKey) {
  $('deviceKey').value = savedKey;
  verifyKey();
}
runChecks();
renderLog();
