import { now } from './now.js';
import { generateId, loadState, saveState, createDefaultState } from './storage.js';
import * as transport from './transport.js';
import { beep, vibrate } from './signals.js';

let state = loadState();
let confirmCallback = null;
let pairingEditMode = false;
let lastFlashedRentreTs = null;
let stateUnsubscribe = null;
let flushingLaps = false;
let alarmHoldTimer = null;
const alarmAckUnsubscribes = new Map();
let qrStream = null;
let qrRafId = null;

const ALARM_HOLD_MS = 600;

const el = {
  timerSession: document.getElementById('timer-session'),
  pilotActuel: document.getElementById('pilote-actuel'),
  piloteDivergence: document.getElementById('pilote-divergence'),
  tourBtn: document.getElementById('tour-btn'),
  tourBtnHint: document.getElementById('tour-btn-hint'),
  lastLapValue: document.getElementById('last-lap-value'),
  recordingToggleBtn: document.getElementById('recording-toggle-btn'),
  recordingStatus: document.getElementById('recording-status'),
  undoBtn: document.getElementById('undo-btn'),
  lapsList: document.getElementById('laps-list'),
  lapsCount: document.getElementById('laps-count'),
  lapsPending: document.getElementById('laps-pending'),
  exportBtn: document.getElementById('export-btn'),
  resetBtn: document.getElementById('reset-btn'),
  changePilotBtn: document.getElementById('change-pilote-btn'),

  pilotModal: document.getElementById('pilote-modal'),
  pilotList: document.getElementById('pilote-list'),
  pilotAddForm: document.getElementById('pilote-add-form'),
  pilotAddInput: document.getElementById('pilote-add-input'),
  pilotModalClose: document.getElementById('pilote-modal-close'),

  confirmModal: document.getElementById('confirm-modal'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmOk: document.getElementById('confirm-ok'),
  confirmCancel: document.getElementById('confirm-cancel'),

  toast: document.getElementById('toast'),

  connectivityDot: document.getElementById('connectivity-dot'),
  connectivityLabel: document.getElementById('connectivity-label'),
  settingsBtn: document.getElementById('settings-btn'),

  pairingJoin: document.getElementById('pairing-join'),
  pairingJoined: document.getElementById('pairing-joined'),
  pairingCodeInput: document.getElementById('pairing-code-input'),
  pairingScanBtn: document.getElementById('pairing-scan-btn'),
  pairingJoinBtn: document.getElementById('pairing-join-btn'),
  pairingCodeDisplay: document.getElementById('pairing-code-display'),
  pairingChangeBtn: document.getElementById('pairing-change-btn'),

  qrModal: document.getElementById('qr-modal'),
  qrVideo: document.getElementById('qr-video'),
  qrCancelBtn: document.getElementById('qr-cancel-btn'),

  settingsModal: document.getElementById('settings-modal'),
  settingsConfigInput: document.getElementById('settings-config-input'),
  settingsError: document.getElementById('settings-error'),
  settingsSaveBtn: document.getElementById('settings-save-btn'),
  settingsClearBtn: document.getElementById('settings-clear-btn'),
  settingsCloseBtn: document.getElementById('settings-close-btn'),

  alarmBtn: document.getElementById('alarm-btn'),
  alarmBtnFill: document.getElementById('alarm-btn-fill'),
  alarmStatus: document.getElementById('alarm-status'),

  relaisCard: document.getElementById('relais-card'),
  relaisLabel: document.getElementById('relais-label'),
  relaisCountdown: document.getElementById('relais-countdown'),
  courseCountdownLine: document.getElementById('course-countdown-line'),
  courseCountdown: document.getElementById('course-countdown'),

  rentreBanner: document.getElementById('rentre-banner'),
  rentreOverlay: document.getElementById('rentre-overlay'),
  rentreOverlayOk: document.getElementById('rentre-overlay-ok'),
};

function persist() {
  saveState(state);
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function formatDuration(ms, { tenths = false } = {}) {
  const totalMs = Math.max(0, ms);
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const tenth = Math.floor((totalMs % 1000) / 100);

  let out;
  if (hours > 0) {
    out = `${hours}:${pad(minutes)}:${pad(seconds)}`;
  } else {
    out = `${minutes}:${pad(seconds)}`;
  }
  if (tenths) out += `.${tenth}`;
  return out;
}

function currentPilote() {
  return state.pilotes.find((p) => p.id === state.pilote_courant_id) || null;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove('visible'), 2200);
}

// ---- Core actions (Phase A) ----

function recordLap() {
  if (!state.recording_active) return;
  const t = now();
  const prevRef = state.last_lap_ts ?? state.session_start_ts;
  const valeur_chrono = Math.max(0, t - prevRef);
  const pilote = currentPilote();

  const lap = {
    id_unique: generateId(),
    id_course: state.id_course,
    timestamp: t,
    valeur_chrono,
    pilote_vu_tel: pilote ? pilote.nom : null,
    id_relais_estime: state.relais_estime_courant,
  };

  state.laps.push(lap);
  state.last_lap_ts = t;
  persist();
  render();
  flushLapQueue();
}

function undoLastLap() {
  if (state.laps.length === 0) return;
  const removed = state.laps.pop();
  state.synced_lap_ids = state.synced_lap_ids.filter((id) => id !== removed.id_unique);
  state.last_lap_ts = state.laps.length
    ? state.laps[state.laps.length - 1].timestamp
    : null;
  persist();
  render();
  showToast('Dernier tour annulé.');
}

function toggleRecording() {
  if (state.recording_active) {
    state.recording_active = false;
    showToast('Enregistrement en pause.');
  } else {
    state.recording_active = true;
    // A pause can last a while; resetting the reference point avoids the
    // next lap silently absorbing the paused duration.
    state.last_lap_ts = now();
    showToast('Enregistrement repris.');
  }
  persist();
  render();
}

function addPilote(nomRaw) {
  const nom = nomRaw.trim();
  if (!nom) return;
  const pilote = { id: generateId(), nom };
  state.pilotes.push(pilote);
  if (!state.pilote_courant_id) {
    // First pilot ever set: this is initial setup, not a mid-session
    // correction, so it doesn't count as a stint change.
    state.pilote_courant_id = pilote.id;
  }
  persist();
  render();
  renderPiloteModal();
}

function selectPilote(id) {
  if (id === state.pilote_courant_id) {
    closePiloteModal();
    return;
  }
  state.pilote_courant_id = id;
  state.relais_estime_courant += 1;
  persist();
  render();
  closePiloteModal();
}

function resetSession() {
  teardownCourseSubscription();
  alarmAckUnsubscribes.forEach((unsub) => unsub());
  alarmAckUnsubscribes.clear();
  lastFlashedRentreTs = null;
  pairingEditMode = false;

  const keepPilotes = state.pilotes;
  const keepCurrent = state.pilote_courant_id;
  state = createDefaultState();
  state.pilotes = keepPilotes;
  state.pilote_courant_id = keepCurrent;
  persist();
  render();
  showToast('Nouvelle session démarrée.');
}

function exportSession() {
  const lapsById = {};
  for (const lap of state.laps) {
    lapsById[lap.id_unique] = lap;
  }
  const payload = {
    id_course: state.id_course,
    exported_ts: now(),
    laps: lapsById,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date(now());
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const filename = `chronos_${state.id_course || 'local'}_${stamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Export : ${filename}`);
}

// ---- Pairing (§16.3) ----

function normalizeCode(raw) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function joinCourse(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) {
    showToast('Code invalide.');
    return;
  }
  // Laps recorded before pairing haven't been sent anywhere yet: attach
  // them to this course instead of leaving them orphaned.
  state.laps.forEach((lap) => {
    if (!lap.id_course) lap.id_course = code;
  });
  state.id_course = code;
  state.paired_ts = now();
  pairingEditMode = false;
  persist();
  render();
  subscribeToCourse();
  showToast(`Course rejointe : ${code}`);
}

function changeCourse() {
  pairingEditMode = true;
  el.pairingCodeInput.value = state.id_course || '';
  render();
  el.pairingCodeInput.focus();
}

function supportsQr() {
  return 'BarcodeDetector' in window;
}

function extractCodeFromScan(text) {
  const match = text.match(/[A-Za-z0-9]{4,8}/);
  return match ? match[0] : text;
}

async function openQrScan() {
  if (!supportsQr()) {
    showToast('Scan QR non supporté sur cet appareil.');
    return;
  }
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    el.qrVideo.srcObject = qrStream;
    await el.qrVideo.play();
    el.qrModal.classList.remove('hidden');
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!qrStream) return;
      try {
        const codes = await detector.detect(el.qrVideo);
        if (codes.length > 0) {
          const text = codes[0].rawValue || '';
          closeQrScan();
          joinCourse(extractCodeFromScan(text));
          return;
        }
      } catch (err) {
        console.error('Lecture QR échouée', err);
      }
      qrRafId = requestAnimationFrame(tick);
    };
    qrRafId = requestAnimationFrame(tick);
  } catch (err) {
    console.error('Caméra indisponible', err);
    showToast('Caméra indisponible ou permission refusée.');
    closeQrScan();
  }
}

function closeQrScan() {
  if (qrRafId) cancelAnimationFrame(qrRafId);
  qrRafId = null;
  if (qrStream) {
    qrStream.getTracks().forEach((track) => track.stop());
    qrStream = null;
  }
  el.qrVideo.srcObject = null;
  el.qrModal.classList.add('hidden');
}

// ---- Transport: connectivity + PC state (§16.8) ----

function renderConnectivity() {
  const configured = transport.isConfigured();
  const connected = transport.isConnected();
  el.connectivityDot.className = 'connectivity-dot ' + (!configured ? 'unconfigured' : connected ? 'connected' : 'disconnected');
  el.connectivityLabel.textContent = !configured
    ? 'Relais non configuré'
    : connected ? 'Relais connecté' : 'Relais hors ligne';
}

function subscribeToCourse() {
  teardownCourseSubscription();
  if (!state.id_course || !transport.isConfigured()) return;
  stateUnsubscribe = transport.listenState(state.id_course, onPcState);
  flushLapQueue();
}

function teardownCourseSubscription() {
  if (stateUnsubscribe) {
    stateUnsubscribe();
    stateUnsubscribe = null;
  }
}

function mergePcRoster(names) {
  names.forEach((nom) => {
    if (typeof nom !== 'string' || !nom.trim()) return;
    const exists = state.pilotes.some((p) => p.nom === nom);
    if (!exists) state.pilotes.push({ id: generateId(), nom });
  });
}

function adoptPcPiloteIfNone(nom) {
  if (state.pilote_courant_id) return;
  const pilote = state.pilotes.find((p) => p.nom === nom);
  if (pilote) state.pilote_courant_id = pilote.id;
}

function onPcState(raw) {
  if (!raw) return; // nothing published yet — keep current fallback UI
  if (Array.isArray(raw.roster)) {
    mergePcRoster(raw.roster);
    state.pc_roster = raw.roster;
  }
  state.pc_pilote_courant = typeof raw.pilote_courant === 'string' ? raw.pilote_courant : null;
  if (state.pc_pilote_courant) adoptPcPiloteIfNone(state.pc_pilote_courant);
  state.relais_snapshot = raw.relais || null;
  state.course_snapshot = raw.course || null;
  state.pause = !!raw.pause;
  state.rentre = raw.rentre || null;
  state.pc_state_recv_ts = now();
  persist();
  render();
  maybeSignalRentre();
}

// ---- Lap send queue (§16.6) — idempotent by id_unique, USB/relay coexist ----

async function flushLapQueue() {
  if (flushingLaps) return;
  if (!transport.isConfigured() || !state.id_course) return;
  flushingLaps = true;
  try {
    const pending = state.laps.filter(
      (l) => l.id_course && !state.synced_lap_ids.includes(l.id_unique)
    );
    for (const lap of pending) {
      try {
        await transport.pushLap(state.id_course, lap);
        state.synced_lap_ids.push(lap.id_unique);
        persist();
      } catch (err) {
        // Stays pending; the periodic retry loop will pick it up again.
      }
    }
  } finally {
    flushingLaps = false;
    render();
  }
}

// ---- ALARME (§16.7) — fast lane, bypasses the lap queue ----

function startAlarmHold(e) {
  e.preventDefault();
  el.alarmBtnFill.style.setProperty('--alarm-hold-ms', `${ALARM_HOLD_MS}ms`);
  el.alarmBtnFill.classList.add('filling');
  alarmHoldTimer = setTimeout(() => {
    fireAlarm();
    resetAlarmFill();
  }, ALARM_HOLD_MS);
}

function cancelAlarmHold() {
  clearTimeout(alarmHoldTimer);
  alarmHoldTimer = null;
  resetAlarmFill();
}

function resetAlarmFill() {
  el.alarmBtnFill.classList.remove('filling');
  void el.alarmBtnFill.offsetWidth; // force reflow so the next hold restarts from empty
}

function fireAlarm() {
  const alarm = {
    id_unique: generateId(),
    id_course: state.id_course,
    timestamp: now(),
    type: 'ALERTE',
    acked: false,
    ack_ts: null,
  };
  state.alarms.push(alarm);
  if (state.alarms.length > 5) state.alarms = state.alarms.slice(-5);
  persist();
  render();
  vibrate([80]);
  sendAlarm(alarm);
}

function listenAlarmAckIfNeeded(alarm) {
  if (!state.id_course || alarmAckUnsubscribes.has(alarm.id_unique)) return;
  const unsub = transport.listenAlarmAck(state.id_course, alarm.id_unique, (ackVal) => {
    if (!ackVal) return;
    const found = state.alarms.find((a) => a.id_unique === alarm.id_unique);
    if (found && !found.acked) {
      found.acked = true;
      found.ack_ts = ackVal.timestamp || now();
      persist();
      render();
      beep({ frequency: 520, times: 1 });
    }
  });
  alarmAckUnsubscribes.set(alarm.id_unique, unsub);
}

async function sendAlarm(alarm) {
  if (!state.id_course) {
    render(); // derived status will read "Non remis (réseau)"
    return;
  }
  listenAlarmAckIfNeeded(alarm);
  try {
    await transport.pushAlarm(state.id_course, alarm);
  } catch (err) {
    // Retried by the interval loop below until acked.
  }
  render();
}

function retryUnackedAlarms() {
  if (!transport.isConfigured() || !state.id_course) return;
  state.alarms
    .filter((a) => !a.acked)
    .forEach((a) => {
      listenAlarmAckIfNeeded(a);
      transport.pushAlarm(state.id_course, a).catch(() => {});
    });
}

// ---- Rendering ----

function render() {
  el.timerSession.textContent = formatDuration(now() - state.session_start_ts);

  const pilote = currentPilote();
  el.pilotActuel.textContent = pilote ? pilote.nom : 'Aucun pilote sélectionné';

  el.tourBtn.disabled = !state.recording_active;
  el.tourBtn.classList.toggle('paused', !state.recording_active);
  el.tourBtnHint.textContent = state.recording_active
    ? 'Appuie à chaque passage'
    : 'Enregistrement en pause';

  if (state.recording_active) {
    el.recordingToggleBtn.textContent = 'STOP enregistrement';
    el.recordingStatus.textContent = 'Enregistrement en cours';
    el.recordingStatus.classList.remove('paused');
  } else {
    el.recordingToggleBtn.textContent = 'REPRENDRE enregistrement';
    el.recordingStatus.textContent = 'Enregistrement en pause';
    el.recordingStatus.classList.add('paused');
  }

  el.undoBtn.disabled = state.laps.length === 0;
  el.lapsCount.textContent = state.laps.length;

  const lastLap = state.laps[state.laps.length - 1];
  el.lastLapValue.textContent = lastLap ? formatDuration(lastLap.valeur_chrono, { tenths: true }) : '—';

  renderLapsList();
  renderPending();
  renderPairing();
  renderConnectivity();
  renderRelais();
  renderDivergence();
  renderAlarmStatus();
}

function renderPending() {
  if (!state.id_course) {
    el.lapsPending.classList.add('hidden');
    return;
  }
  const pending = state.laps.filter((l) => !state.synced_lap_ids.includes(l.id_unique)).length;
  if (pending === 0) {
    el.lapsPending.classList.add('hidden');
    return;
  }
  el.lapsPending.textContent = `· ${pending} en attente d'envoi`;
  el.lapsPending.classList.remove('hidden');
}

function renderLapsList() {
  el.lapsList.innerHTML = '';
  const laps = state.laps.slice().reverse().slice(0, 20);
  if (laps.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'laps-empty';
    empty.textContent = 'Aucun tour enregistré pour l’instant.';
    el.lapsList.appendChild(empty);
    return;
  }
  laps.forEach((lap) => {
    const index = state.laps.indexOf(lap) + 1;
    const li = document.createElement('li');
    li.className = 'lap-item';
    const d = new Date(lap.timestamp);
    li.innerHTML = `
      <span class="lap-num">#${index}</span>
      <span class="lap-value">${formatDuration(lap.valeur_chrono, { tenths: true })}</span>
      <span class="lap-pilote">${lap.pilote_vu_tel || '—'}</span>
      <span class="lap-time">${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</span>
    `;
    el.lapsList.appendChild(li);
  });
}

function renderPairing() {
  const joined = !!state.id_course && !pairingEditMode;
  el.pairingJoin.classList.toggle('hidden', joined);
  el.pairingJoined.classList.toggle('hidden', !joined);
  el.pairingCodeDisplay.textContent = state.id_course || '—';
}

function renderRelais() {
  const snap = state.relais_snapshot;
  if (!snap || !snap.cible_fin_ts) {
    el.relaisCard.classList.add('hidden');
    return;
  }
  el.relaisCard.classList.remove('hidden');
  const remainingMs = state.pause
    ? snap.cible_fin_ts - (state.pc_state_recv_ts ?? now())
    : snap.cible_fin_ts - now();
  const approx = snap.mode_alerte === 'tours';
  const active = !!(state.rentre && state.rentre.actif);

  el.relaisCard.classList.toggle('active', active);
  el.relaisCard.classList.toggle('paused', state.pause && !active);
  el.relaisLabel.textContent = active
    ? 'RENTRE AU STAND'
    : state.pause
      ? 'Fin de relais (en pause)'
      : 'Fin de relais';
  el.relaisCountdown.textContent = (approx ? '≈ ' : '') + formatDuration(remainingMs);

  if (state.course_snapshot && state.course_snapshot.fin_ts) {
    el.courseCountdownLine.classList.remove('hidden');
    el.courseCountdown.textContent = formatDuration(Math.max(0, state.course_snapshot.fin_ts - now()));
  } else {
    el.courseCountdownLine.classList.add('hidden');
  }
}

function renderDivergence() {
  const pilote = currentPilote();
  if (state.pc_pilote_courant && pilote && pilote.nom !== state.pc_pilote_courant) {
    el.piloteDivergence.textContent = `⚠ PC indique : ${state.pc_pilote_courant}`;
    el.piloteDivergence.classList.remove('hidden');
  } else {
    el.piloteDivergence.classList.add('hidden');
  }
}

function renderAlarmStatus() {
  const last = state.alarms[state.alarms.length - 1];
  if (!last) {
    el.alarmStatus.classList.add('hidden');
    return;
  }
  el.alarmStatus.classList.remove('hidden', 'sending', 'acked', 'unsent');
  if (last.acked) {
    el.alarmStatus.textContent = 'PC prévenu ✓';
    el.alarmStatus.classList.add('acked');
  } else if (!state.id_course || !transport.isConfigured() || !transport.isConnected()) {
    el.alarmStatus.textContent = 'Non remis (réseau) — repli voix/radio';
    el.alarmStatus.classList.add('unsent');
  } else {
    el.alarmStatus.textContent = 'Envoi…';
    el.alarmStatus.classList.add('sending');
  }
}

function maybeSignalRentre() {
  const r = state.rentre;
  if (!r || !r.actif) {
    el.rentreBanner.classList.add('hidden');
    return;
  }
  el.rentreBanner.textContent = '🚩 RENTRE AU STAND';
  el.rentreBanner.classList.remove('hidden');
  if (r.ts !== lastFlashedRentreTs) {
    lastFlashedRentreTs = r.ts;
    el.rentreOverlay.classList.remove('hidden');
    beep({ frequency: 660, times: 3 });
    vibrate([200, 100, 200, 100, 400]);
  }
}

// ---- Pilote modal ----

function openPiloteModal() {
  renderPiloteModal();
  el.pilotModal.classList.remove('hidden');
  el.pilotAddInput.focus();
}

function closePiloteModal() {
  el.pilotModal.classList.add('hidden');
  el.pilotAddForm.reset();
}

function renderPiloteModal() {
  el.pilotList.innerHTML = '';
  if (state.pilotes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'pilote-list-empty';
    empty.textContent = 'Aucun pilote enregistré. Ajoute-en un ci-dessous.';
    el.pilotList.appendChild(empty);
    return;
  }
  state.pilotes.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pilote-option';
    if (p.id === state.pilote_courant_id) btn.classList.add('selected');
    btn.textContent = p.nom + (p.id === state.pilote_courant_id ? ' (actuel)' : '');
    btn.addEventListener('click', () => selectPilote(p.id));
    el.pilotList.appendChild(btn);
  });
}

// ---- Confirm modal ----

function openConfirm(message, onConfirm) {
  el.confirmMessage.textContent = message;
  confirmCallback = onConfirm;
  el.confirmModal.classList.remove('hidden');
}

function closeConfirm() {
  el.confirmModal.classList.add('hidden');
  confirmCallback = null;
}

// ---- Settings modal (relay/transport config) ----

function openSettings() {
  const cfg = transport.loadTransportConfig();
  el.settingsConfigInput.value = cfg ? JSON.stringify(cfg, null, 2) : '';
  el.settingsError.classList.add('hidden');
  el.settingsModal.classList.remove('hidden');
}

function closeSettings() {
  el.settingsModal.classList.add('hidden');
}

// Locates the { ... } object literal that contains "databaseURL", walking
// out to its enclosing braces. This lets the user paste Firebase's full
// setup snippet as-is (imports, comments, initializeApp(...) call and all)
// instead of having to trim it down to just the config object by hand.
function extractConfigObjectLiteral(raw) {
  const markerIndex = raw.indexOf('databaseURL');
  if (markerIndex === -1) throw new Error('databaseURL introuvable dans le texte collé');

  let depth = 0;
  let start = -1;
  for (let i = markerIndex; i >= 0; i--) {
    if (raw[i] === '}') depth++;
    else if (raw[i] === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start === -1) throw new Error('accolade ouvrante du bloc de config introuvable');

  depth = 0;
  let end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error('accolade fermante du bloc de config introuvable');

  return raw.slice(start, end + 1);
}

function parseFirebaseConfigInput(raw) {
  const objLiteral = extractConfigObjectLiteral(raw);
  // Accepts both strict JSON and the JS object literal Firebase's console
  // hands out (unquoted keys) — safe here since it only ever runs text the
  // user pasted into their own browser.
  const cfg = new Function(`"use strict"; return (${objLiteral});`)();
  if (!cfg || typeof cfg !== 'object' || !cfg.databaseURL) {
    throw new Error('databaseURL manquant dans la config');
  }
  return cfg;
}

function saveSettings() {
  const raw = el.settingsConfigInput.value.trim();
  if (!raw) {
    clearSettings();
    return;
  }
  try {
    const cfg = parseFirebaseConfigInput(raw);
    transport.saveTransportConfig(cfg);
    closeSettings();
    renderConnectivity();
    if (state.id_course) subscribeToCourse();
    showToast('Config relais enregistrée.');
  } catch (err) {
    el.settingsError.textContent = 'Config invalide : ' + err.message;
    el.settingsError.classList.remove('hidden');
  }
}

function clearSettings() {
  transport.clearTransportConfig();
  el.settingsConfigInput.value = '';
  closeSettings();
  renderConnectivity();
  showToast('Config relais effacée — l’appli reste utilisable en local.');
}

// ---- Wiring ----

el.tourBtn.addEventListener('click', recordLap);
el.undoBtn.addEventListener('click', undoLastLap);
el.recordingToggleBtn.addEventListener('click', toggleRecording);
el.changePilotBtn.addEventListener('click', openPiloteModal);
el.pilotModalClose.addEventListener('click', closePiloteModal);
el.pilotModal.addEventListener('click', (e) => {
  if (e.target === el.pilotModal) closePiloteModal();
});
el.pilotAddForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addPilote(el.pilotAddInput.value);
  el.pilotAddInput.value = '';
  el.pilotAddInput.focus();
});

el.exportBtn.addEventListener('click', exportSession);

el.resetBtn.addEventListener('click', () => {
  openConfirm(
    'Nouvelle session : les tours locaux non exportés seront perdus. Confirmer ?',
    resetSession
  );
});

el.confirmOk.addEventListener('click', () => {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
});
el.confirmCancel.addEventListener('click', closeConfirm);
el.confirmModal.addEventListener('click', (e) => {
  if (e.target === el.confirmModal) closeConfirm();
});

el.pairingJoinBtn.addEventListener('click', () => joinCourse(el.pairingCodeInput.value));
el.pairingCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinCourse(el.pairingCodeInput.value);
});
el.pairingChangeBtn.addEventListener('click', changeCourse);
el.pairingScanBtn.addEventListener('click', openQrScan);
el.qrCancelBtn.addEventListener('click', closeQrScan);
el.qrModal.addEventListener('click', (e) => {
  if (e.target === el.qrModal) closeQrScan();
});

el.settingsBtn.addEventListener('click', openSettings);
el.settingsCloseBtn.addEventListener('click', closeSettings);
el.settingsModal.addEventListener('click', (e) => {
  if (e.target === el.settingsModal) closeSettings();
});
el.settingsSaveBtn.addEventListener('click', saveSettings);
el.settingsClearBtn.addEventListener('click', clearSettings);

el.alarmBtn.addEventListener('pointerdown', startAlarmHold);
['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) =>
  el.alarmBtn.addEventListener(evt, cancelAlarmHold)
);

el.rentreOverlayOk.addEventListener('click', () => el.rentreOverlay.classList.add('hidden'));
el.rentreBanner.addEventListener('click', () => el.rentreOverlay.classList.remove('hidden'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePiloteModal();
    closeConfirm();
    closeQrScan();
    closeSettings();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    render();
    flushLapQueue();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.error('Enregistrement du service worker échoué', err);
    });
  });
}

// ---- Startup ----

transport.onConnectivityChange(() => {
  renderConnectivity();
  flushLapQueue();
});
el.pairingScanBtn.classList.toggle('hidden', !supportsQr());
if (state.id_course) subscribeToCourse();
state.alarms.filter((a) => !a.acked).forEach((a) => listenAlarmAckIfNeeded(a));

render();
maybeSignalRentre(); // restore banner/flash if still active after a refresh
setInterval(render, 500);
setInterval(flushLapQueue, 6000);
setInterval(retryUnackedAlarms, 3000);
persist();
