'use strict';

/* ------------------------------------------------------------------
   Milestone 1: PWA shell + device capability check.
   Nothing here touches maps, GPS or game logic. That comes later.
------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

/* ---------- report model ---------- */

const checks = new Map(); // id -> { label, status, detail }

function setCheck(id, label, status, detail) {
  checks.set(id, { label, status, detail: detail || '' });
  renderChecks();
}

function renderChecks() {
  const list = $('checks');
  list.innerHTML = '';
  const symbol = { ok: 'âœ“', warn: '!', bad: 'âœ—', info: 'â€¢' };
  for (const { label, status, detail } of checks.values()) {
    const li = document.createElement('li');
    li.className = status;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.textContent = symbol[status] || 'â€¢';
    const name = document.createElement('span');
    name.textContent = label;
    li.append(dot, name);
    if (detail) {
      const d = document.createElement('span');
      d.className = 'detail';
      d.textContent = detail;
      li.append(d);
    }
    list.append(li);
  }
}

function log(msg) {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
}

/* ---------- state shared with the verdict ---------- */

const state = {
  secure: false,
  hasXR: false,
  arSupported: null, // true / false / null (unknown)
  probe: null,       // result of the real session test
};

/* ---------- passive checks (no permission prompts) ---------- */

async function runPassiveChecks() {
  // Secure context
  state.secure = window.isSecureContext;
  setCheck('secure', 'Secure context (HTTPS)',
    state.secure ? 'ok' : 'bad',
    state.secure
      ? location.origin
      : 'Not secure. WebXR, camera and GPS will not work. Open the https:// address.');

  // Browser
  const ua = navigator.userAgent;
  const chrome = ua.match(/(?:Chrome|Chromium)\/(\d+)/);
  const android = /Android/i.test(ua);
  const samsung = /SamsungBrowser\/(\d+)/.exec(ua);
  let browser = 'Unrecognised browser';
  if (samsung) browser = 'Samsung Internet ' + samsung[1];
  else if (chrome) browser = 'Chromium-based browser, version ' + chrome[1];
  setCheck('browser', 'Browser',
    android && chrome ? 'ok' : 'warn',
    browser + (android ? ' on Android' : ' (not Android)') +
    (android ? '' : '. This project targets Chrome on Android.'));

  // Display mode
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  setCheck('display', 'Running as', 'info',
    standalone ? 'Installed app (standalone)' : 'Browser tab');

  // Service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      setCheck('sw', 'Service worker (offline shell)', 'ok', 'Registered');
    } catch (e) {
      setCheck('sw', 'Service worker (offline shell)', 'bad', 'Registration failed: ' + e.message);
    }
  } else {
    setCheck('sw', 'Service worker (offline shell)', 'bad', 'Not supported here');
  }

  // WebGL
  const gl = document.createElement('canvas').getContext('webgl2') ||
             document.createElement('canvas').getContext('webgl');
  setCheck('webgl', '3D graphics (WebGL)', gl ? 'ok' : 'bad',
    gl ? 'Available' : 'Not available. 3D rendering will not work.');

  // WebXR
  state.hasXR = 'xr' in navigator;
  setCheck('xr', 'WebXR API present', state.hasXR ? 'ok' : 'bad',
    state.hasXR ? 'navigator.xr exists' : 'navigator.xr is missing. Use Chrome on Android.');

  // immersive-ar
  if (state.hasXR) {
    try {
      state.arSupported = await navigator.xr.isSessionSupported('immersive-ar');
      setCheck('ar', 'Immersive AR reported supported',
        state.arSupported ? 'ok' : 'bad',
        state.arSupported
          ? 'The browser says AR sessions are possible. Confirm with "Test AR session".'
          : 'The browser says no. Usually this means ARCore ("Google Play Services for AR") ' +
            'is missing or the phone is not ARCore-certified.');
    } catch (e) {
      state.arSupported = false;
      setCheck('ar', 'Immersive AR reported supported', 'bad', 'Check failed: ' + e.message);
    }
  } else {
    state.arSupported = false;
    setCheck('ar', 'Immersive AR reported supported', 'bad', 'Skipped: no WebXR');
  }

  // APIs needed later. We only check that they exist. No permission prompt.
  setCheck('camera', 'Camera API present', navigator.mediaDevices?.getUserMedia ? 'ok' : 'bad',
    'Needed for the fallback mode');
  setCheck('geo', 'Geolocation API present', 'geolocation' in navigator ? 'ok' : 'bad',
    'Needed in a later milestone. Not requested yet.');

  renderVerdict();
}

/* ---------- verdict ---------- */

function renderVerdict() {
  const v = $('verdict');
  v.className = 'verdict';
  let title, body;

  if (!state.secure) {
    v.classList.add('bad');
    title = 'Not a secure page';
    body = 'Open this app through its https:// address. Nothing else will work until then.';
  } else if (state.probe && state.probe.ok) {
    v.classList.add('ok');
    title = 'True AR session started';
    body = 'Mode A (world-tracked AR) works on this phone. ' +
      (state.probe.hitTest
        ? 'Surface hit-testing is available.'
        : 'Hit-testing was NOT confirmed, so placing objects on surfaces may not work.');
  } else if (state.probe && !state.probe.ok) {
    v.classList.add('bad');
    title = 'AR session failed to start';
    body = state.probe.error + ' The camera-only fallback (Mode B) is still possible, ' +
      'but it is not world-tracked.';
  } else if (state.arSupported) {
    v.classList.add('warn');
    title = 'AR looks possible: not confirmed yet';
    body = 'Tap "Test AR session" to find out for certain. ' +
      'Nothing is proven until that test runs.';
  } else {
    v.classList.add('bad');
    title = 'True AR is not available here';
    body = 'Only the camera-overlay fallback (Mode B) could work. ' +
      'It shows a 3D object over the camera but does not track the real world.';
  }
  v.innerHTML = '';
  const s = document.createElement('strong');
  s.textContent = title;
  v.append(s, body);
}

/* ---------- active test: start a real AR session briefly ---------- */

async function probeAR() {
  if (!state.hasXR) { log('No WebXR here.'); return; }
  const btn = $('btn-probe');
  btn.disabled = true;
  log('Requesting AR session. The camera permission prompt may appear.');

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: ['hit-test', 'anchors', 'dom-overlay', 'light-estimation'],
      domOverlay: { root: document.body },
    });
  } catch (e) {
    state.probe = { ok: false, error: e.name + ': ' + e.message + '.' };
    setCheck('probe', 'AR session', 'bad', e.name + ': ' + e.message);
    renderVerdict();
    btn.disabled = false;
    return;
  }

  const enabled = session.enabledFeatures ? Array.from(session.enabledFeatures) : null;
  log('Session started. Enabled features: ' + (enabled ? enabled.join(', ') : 'unknown (older Chrome)'));

  let frames = 0, poses = 0, hitTestOk = false, hitError = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true });
    await gl.makeXRCompatible?.();
    await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

    const local = await session.requestReferenceSpace('local');

    // Real hit-test check: try to create a source instead of trusting a flag.
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      const src = await session.requestHitTestSource({ space: viewer });
      hitTestOk = !!src;
      src?.cancel?.();
    } catch (e) {
      hitError = e.name + ': ' + e.message;
    }

    await new Promise((resolve) => {
      const stopAt = performance.now() + 2500;
      session.addEventListener('end', resolve, { once: true });
      const onFrame = (t, frame) => {
        frames++;
        if (frame.getViewerPose(local)) poses++;
        gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (t < stopAt) session.requestAnimationFrame(onFrame);
        else session.end().catch(() => {});
      };
      session.requestAnimationFrame(onFrame);
    });
  } catch (e) {
    log('Probe error: ' + e.name + ': ' + e.message);
  }

  const anchorsFlag = enabled ? enabled.includes('anchors') : null;
  state.probe = { ok: frames > 0 && poses > 0, hitTest: hitTestOk, error: 'Session opened but no tracked frames arrived.' };

  setCheck('probe', 'AR session', state.probe.ok ? 'ok' : 'bad',
    frames + ' frames rendered, ' + poses + ' with a tracked device pose.');
  setCheck('hittest', 'Hit-test (find floor/surfaces)', hitTestOk ? 'ok' : 'bad',
    hitTestOk ? 'A hit-test source was created.' : (hitError || 'Could not create a hit-test source.'));
  setCheck('anchors', 'Anchors (keep object fixed in the world)',
    anchorsFlag === null ? 'info' : anchorsFlag ? 'ok' : 'warn',
    anchorsFlag === null ? 'Unknown on this Chrome version.'
      : anchorsFlag ? 'Enabled in the session.'
      : 'Not enabled. Placement can still work using the hit-test pose alone.');
  setCheck('overlay', 'DOM overlay (buttons over AR view)',
    enabled ? (enabled.includes('dom-overlay') ? 'ok' : 'warn') : 'info',
    enabled ? (enabled.includes('dom-overlay') ? 'Enabled.' : 'Not enabled. We would draw UI in 3D instead.') : 'Unknown.');

  renderVerdict();
  btn.disabled = false;
}

/* ---------- fallback test: camera only (Mode B) ---------- */

let camStream = null;

async function toggleCamera() {
  const video = $('cam');
  const note = $('cam-note');
  const btn = $('btn-camera');

  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
    video.hidden = true;
    note.hidden = true;
    btn.textContent = 'Test camera only';
    setCheck('camtest', 'Camera feed', 'info', 'Stopped');
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = camStream;
    await video.play();
    video.hidden = false;
    note.hidden = false;
    btn.textContent = 'Stop camera';
    setCheck('camtest', 'Camera feed', 'ok', 'Working (fallback mode only, not AR)');
  } catch (e) {
    setCheck('camtest', 'Camera feed', 'bad', e.name + ': ' + e.message);
  }
}

/* ---------- install button ---------- */

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('btn-install').hidden = false;
});
$('btn-install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('btn-install').hidden = true;
});
window.addEventListener('appinstalled', () => {
  setCheck('installed', 'App installed', 'ok', 'Added to your home screen');
});

/* ---------- copy report ---------- */

async function copyReport() {
  const lines = ['Dungeon AR device report', 'UA: ' + navigator.userAgent];
  for (const { label, status, detail } of checks.values()) {
    lines.push(`[${status}] ${label}${detail ? ' - ' + detail : ''}`);
  }
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    log('Report copied. Paste it into the chat.');
  } catch {
    log(text); // clipboard blocked: show it so it can be selected manually
  }
}

/* ---------- wire up ---------- */

$('btn-probe').addEventListener('click', probeAR);
$('btn-camera').addEventListener('click', toggleCamera);
$('btn-copy').addEventListener('click', copyReport);

runPassiveChecks();
