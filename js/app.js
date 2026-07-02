import { now } from './now.js';
import { generateId, loadState, saveState, createDefaultState } from './storage.js';
import * as transport from './transport.js';
import { beep, vibrate } from './signals.js';

let state = loadState();
let currentPage = 'accueil';
let confirmCallback = null;
let pairingEditMode = false;
let lastFlashedRentreTs = null;
let stateUnsubscribe = null;
let flushingLaps = false;
let alarmHoldTimer = null;
const alarmAckUnsubscribes = new Map();
let qrStream = null;
let qrRafId = null;

const ALARM_HOLD_MS = 1200;
const ALARM_IDLE_SUB = 'Maintiens le bouton appuyé pour prévenir le PC';
const ALARM_HOLDING_SUB = 'Continue d’appuyer…';

const el = {
  navRail: document.getElementById('nav-rail'),
  navAlertDot: document.getElementById('nav-alert-dot'),
  pages: {
    accueil: document.getElementById('page-accueil'),
    chrono: document.getElementById('page-chrono'),
    alerte: document.getElementById('page-alerte'),
    course: document.getElementById('page-course'),
  },

  timerSession: document.getElementById('timer-session'),
  chronoSessionTime: document.getElementById('chrono-session-time'),

  pilotActuel: document.getElementById('pilote-actuel'),
  piloteDivergence: document.getElementById('pilote-divergence'),

  tourBtn: document.getElementById('tour-btn'),
  tourPausedTag: document.getElementById('tour-paused-tag'),
  tourBtnHint: document.getElementById('tour-btn-hint'),
  lastLapValue: document.getElementById('last-lap-value'),
  recordingToggleBtn: document.getElementById('recording-toggle-btn'),
  undoBtn: document.getElementById('undo-btn'),
  lapsList: document.getElementById('laps-list'),
  lapsCount: document.getElementById('laps-count'),
  lapsPending: document.getElementById('laps-pending'),
  exportBtn: document.getElementById('export-btn'),
  resetBtn: document.getElementById('reset-btn'),

  pilotList: document.getElementById('pilote-list'),
  pilotAddForm: document.getElementById('pilote-add-form'),
  pilotAddInput: document.getElementById('pilote-add-input'),

  confirmModal: document.getElementById('confirm-modal'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmOk: document.getElementById('confirm-ok'),
  confirmCancel: document.getElementById('confirm-cancel'),

  toast: document.getElementById('toast'),

  connectivityDot: document.getElementById('connectivity-dot'),
  connectivityLabel: document.getElementById('connectivity-label'),
  connectivityDot2: document.getElementById('connectivity-dot-2'),
  connectivityLabel2: document.getElementById('connectivity-label-2'),

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

  settingsConfigInput: document.getElementById('settings-config-input'),
  settingsError: document.getElementById('settings-error'),
  settingsSaveBtn: document.getElementById('settings-save-btn'),
  settingsClearBtn: document.getElementById('settings-clear-btn'),

  alarmBtn: document.getElementById('alarm-btn'),
  alarmBtnFill: document.getElementById('alarm-btn-fill'),
  alarmSub: document.getElementById('alarm-sub'),
  alarmStatus: document.getElementById('alarm-status'),

  relaisCard: document.getElementById('relais-card'),
  relaisLabel: document.getElementById('relais-label'),
  relaisCountdown: document.getElementById('relais-countdown'),
  relaisRentreTag: document.getElementById('relais-rentre-tag'),
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

// ---- Navigation ----

function goToPage(page) {
  if (!el.pages[page]) return;
  currentPage = page;
  for (const [name, section] of Object.entries(el.pages)) {
    section.classList.toggle('hidden', name !== page);
  }
  for (const btn of el.navRail.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.page === page);
  }
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
  } else if (state.session_start_ts === null) {
    // First start: nothing runs until the user explicitly taps Démarrer.
    state.session_start_ts = now();
    state.recording_active = true;
    state.last_lap_ts = null;
    showToast('Session démarrée.');
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
}

function selectPilote(id) {
  if (id === state.pilote_courant_id) return;
  state.pilote_courant_id = id;
  state.relais_estime_courant += 1;
  persist();
  render();
  showToast('Pilote : ' + (currentPilote()?.nom || ''));
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
    // Mirrors the Firebase wire format (valeur_chrono in seconds) so USB
    // import and the live relay parse laps the same way on the PC side.
    lapsById[lap.id_unique] = { ...lap, valeur_chrono: lap.valeur_chrono / 1000 };
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
  const cls = !configured ? 'unset' : connected ? 'ok' : 'off';
  const label = !configured
    ? 'Réseau non configuré'
    : connected ? 'Connecté au PC' : 'Hors ligne — envois en attente';
  for (const [dotEl, labelEl] of [[el.connectivityDot, el.connectivityLabel], [el.connectivityDot2, el.connectivityLabel2]]) {
    dotEl.className = 'status-pill__dot ' + cls;
    labelEl.textContent = label;
  }
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

// Reorders state.pilotes to match the PC's rotation strategy (roster is
// published in stint order), creating any pilot the mobile doesn't know
// about yet. Pilots the mobile knows locally but that aren't in the PC
// roster (e.g. deactivated on PC, or added only on the phone) are kept,
// appended after — never silently dropped.
function mergePcRoster(names) {
  const byName = new Map(state.pilotes.map((p) => [p.nom, p]));
  const ordered = [];
  names.forEach((nom) => {
    if (typeof nom !== 'string' || !nom.trim()) return;
    let pilote = byName.get(nom);
    if (!pilote) pilote = { id: generateId(), nom };
    ordered.push(pilote);
    byName.delete(nom);
  });
  byName.forEach((pilote) => ordered.push(pilote));
  state.pilotes = ordered;
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
  el.alarmSub.textContent = ALARM_HOLDING_SUB;
  el.alarmBtnFill.style.transition = 'none';
  el.alarmBtnFill.style.height = '0%';
  void el.alarmBtnFill.offsetHeight; // force reflow before starting the fill
  el.alarmBtnFill.style.transition = `height ${ALARM_HOLD_MS}ms linear`;
  el.alarmBtnFill.style.height = '100%';
  alarmHoldTimer = setTimeout(() => {
    fireAlarm();
    resetAlarmFill();
  }, ALARM_HOLD_MS);
}

function cancelAlarmHold() {
  clearTimeout(alarmHoldTimer);
  alarmHoldTimer = null;
  resetAlarmFill();
  el.alarmSub.textContent = ALARM_IDLE_SUB;
}

function resetAlarmFill() {
  el.alarmBtnFill.style.transition = 'none';
  el.alarmBtnFill.style.height = '0%';
  void el.alarmBtnFill.offsetHeight;
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
  const sessionTime = state.session_start_ts === null
    ? '0:00'
    : formatDuration(now() - state.session_start_ts);
  el.timerSession.textContent = sessionTime;
  el.chronoSessionTime.textContent = sessionTime;

  const pilote = currentPilote();
  el.pilotActuel.textContent = pilote ? pilote.nom : 'Aucun pilote sélectionné';

  el.tourBtn.disabled = !state.recording_active;
  el.tourBtn.classList.toggle('paused', !state.recording_active);
  el.tourPausedTag.classList.toggle('hidden', state.recording_active);
  el.tourBtnHint.textContent = state.recording_active
    ? 'Appuie à chaque passage sur la ligne'
    : state.session_start_ts === null
      ? 'Appuie sur Démarrer pour commencer'
      : 'Enregistrement en pause';

  if (state.recording_active) {
    el.recordingToggleBtn.textContent = 'STOP enregistrement';
    el.recordingToggleBtn.classList.remove('paused');
  } else if (state.session_start_ts === null) {
    el.recordingToggleBtn.textContent = 'DÉMARRER';
    el.recordingToggleBtn.classList.remove('paused');
  } else {
    el.recordingToggleBtn.textContent = 'REPRENDRE enregistrement';
    el.recordingToggleBtn.classList.add('paused');
  }

  el.undoBtn.disabled = state.laps.length === 0;
  el.lapsCount.textContent = state.laps.length;

  const lastLap = state.laps[state.laps.length - 1];
  el.lastLapValue.textContent = lastLap ? formatDuration(lastLap.valeur_chrono, { tenths: true }) : '—';

  renderLapsList();
  renderPending();
  renderPairing();
  renderPiloteList();
  renderConnectivity();
  renderRelais();
  renderDivergence();
  renderAlarmStatus();
  el.navAlertDot.classList.toggle('hidden', !(state.rentre && state.rentre.actif));
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
  el.lapsPending.textContent = `${pending} en attente`;
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
    li.className = 'lap-row';
    const d = new Date(lap.timestamp);
    li.innerHTML = `
      <span class="lap-row__n">${index}</span>
      <div class="lap-row__mid">
        <div class="lap-row__t">${formatDuration(lap.valeur_chrono, { tenths: true })}</div>
        <div class="lap-row__pilot">${lap.pilote_vu_tel || '—'}</div>
      </div>
      <span class="lap-row__clock">${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</span>
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

function renderPiloteList() {
  el.pilotList.innerHTML = '';
  if (state.pilotes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-desc';
    empty.style.margin = '0 0 4px';
    empty.textContent = 'Aucun pilote enregistré. Ajoute-en un ci-dessous.';
    el.pilotList.appendChild(empty);
    return;
  }
  state.pilotes.forEach((p) => {
    const cur = p.id === state.pilote_courant_id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pilot-row-btn' + (cur ? ' current' : '');
    btn.innerHTML = `<span class="pilot-row-btn__mark">${cur ? '●' : ''}</span><span class="pilot-row-btn__name">${p.nom}</span>`;
    btn.addEventListener('click', () => selectPilote(p.id));
    el.pilotList.appendChild(btn);
  });
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

  el.relaisCard.classList.toggle('urgent', active);
  el.relaisCard.classList.toggle('paused', state.pause && !active);
  el.relaisRentreTag.classList.toggle('hidden', !active);
  el.relaisLabel.textContent = active
    ? 'Fin de relais'
    : state.pause
      ? 'Fin de relais (en pause)'
      : 'Fin de relais';

  if (approx) {
    // "tours restants" display per design spec — falls back to an
    // approximate time countdown if the PC hasn't published a tour count yet.
    el.relaisCountdown.textContent = typeof snap.tours_restants === 'number'
      ? `≈ ${snap.tours_restants}`
      : `≈ ${formatDuration(remainingMs)}`;
  } else {
    el.relaisCountdown.textContent = formatDuration(remainingMs);
  }

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
    el.piloteDivergence.innerHTML = `<span>⚠</span><span>PC indique : ${state.pc_pilote_courant}</span>`;
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
    el.alarmStatus.innerHTML = '<span>✓</span><span>PC prévenu</span>';
    el.alarmStatus.classList.add('acked');
  } else if (!state.id_course || !transport.isConfigured() || !transport.isConnected()) {
    el.alarmStatus.innerHTML = '<span>⚠</span><span>Non remis (réseau)</span>';
    el.alarmStatus.classList.add('unsent');
  } else {
    el.alarmStatus.innerHTML = '<span>◴</span><span>Envoi…</span>';
    el.alarmStatus.classList.add('sending');
  }
}

function maybeSignalRentre() {
  const r = state.rentre;
  if (!r || !r.actif) {
    el.rentreBanner.classList.add('hidden');
    return;
  }
  el.rentreBanner.classList.remove('hidden');
  if (r.ts !== lastFlashedRentreTs) {
    lastFlashedRentreTs = r.ts;
    el.rentreOverlay.classList.remove('hidden');
    beep({ frequency: 660, times: 3 });
    vibrate([200, 100, 200, 100, 400]);
  }
}

// ---- Confirm modal ----

function openConfirm(title, message, onConfirm) {
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message;
  confirmCallback = onConfirm;
  el.confirmModal.classList.remove('hidden');
}

function closeConfirm() {
  el.confirmModal.classList.add('hidden');
  confirmCallback = null;
}

// ---- Settings (relay/transport config) ----

function parseFirebaseConfigInput(raw) {
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

  const objLiteral = raw.slice(start, end + 1);
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
  el.settingsError.classList.add('hidden');
  try {
    const cfg = parseFirebaseConfigInput(raw);
    transport.saveTransportConfig(cfg);
    renderConnectivity();
    if (state.id_course) subscribeToCourse();
    showToast('Relais configuré ✓');
  } catch (err) {
    el.settingsError.textContent = 'Config invalide : ' + err.message;
    el.settingsError.classList.remove('hidden');
  }
}

function clearSettings() {
  transport.clearTransportConfig();
  el.settingsConfigInput.value = '';
  el.settingsError.classList.add('hidden');
  renderConnectivity();
  showToast('Config relais effacée — l’appli reste utilisable en local.');
}

// ---- Wiring ----

for (const btn of el.navRail.querySelectorAll('.nav-item')) {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
}

el.tourBtn.addEventListener('click', recordLap);
el.undoBtn.addEventListener('click', undoLastLap);
el.recordingToggleBtn.addEventListener('click', toggleRecording);
el.pilotAddForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addPilote(el.pilotAddInput.value);
  el.pilotAddInput.value = '';
});

el.exportBtn.addEventListener('click', exportSession);

el.resetBtn.addEventListener('click', () => {
  openConfirm(
    'Nouvelle session ?',
    'Tous les tours enregistrés localement seront effacés. Pense à exporter avant si besoin.',
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
    closeConfirm();
    closeQrScan();
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
el.settingsConfigInput.value = transport.loadTransportConfig()
  ? JSON.stringify(transport.loadTransportConfig(), null, 2)
  : '';
if (state.id_course) subscribeToCourse();
state.alarms.filter((a) => !a.acked).forEach((a) => listenAlarmAckIfNeeded(a));

goToPage('accueil');
render();
maybeSignalRentre(); // restore banner/flash if still active after a refresh
setInterval(render, 500);
setInterval(flushLapQueue, 6000);
setInterval(retryUnackedAlarms, 3000);
persist();
