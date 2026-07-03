import { now } from './now.js';
import { generateId, loadState, saveState, createDefaultState } from './storage.js';
import * as transport from './transport.js';
import { vibrate, playPreset } from './signals.js';

let state = loadState();
let currentPage = 'accueil';
let confirmCallback = null;
let pairingEditMode = false;
let lastFlashedRentreTs = null;
let lastFlashedCustomAlertTs = null;
let raceOverSignaled = false;
let raceOverDismissed = false;
let alarmStatusAutoHideTimer = null;
let alarmStatusScheduledForId = null;
let alarmStatusDismissedForId = null;
let stateUnsubscribe = null;
let activeMobileUnsubscribe = null;
let flushingLaps = false;
let alarmHoldTimer = null;
const alarmAckUnsubscribes = new Map();
let qrStream = null;
let qrRafId = null;
let histSelRelais = null;
let histFollowCurrent = true; // false once the user manually picks an older relay tab

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
    historique: document.getElementById('page-historique'),
  },

  timerSession: document.getElementById('timer-session'),
  chronoSessionTime: document.getElementById('chrono-session-time'),

  pilotActuel: document.getElementById('pilote-actuel'),
  piloteDivergence: document.getElementById('pilote-divergence'),
  syncPiloteBtn: document.getElementById('sync-pilote-btn'),

  tourBtn: document.getElementById('tour-btn'),
  tourBtnLabel: document.getElementById('tour-btn-label'),
  tourPausedTag: document.getElementById('tour-paused-tag'),
  tourBtnHint: document.getElementById('tour-btn-hint'),
  toursRestantsValue: document.getElementById('tours-restants-value'),
  currentLapValue: document.getElementById('current-lap-value'),
  recordingToggleBtn: document.getElementById('recording-toggle-btn'),
  undoBtn: document.getElementById('undo-btn'),
  lapsList: document.getElementById('laps-list'),
  lapsCount: document.getElementById('laps-count'),
  lapsPending: document.getElementById('laps-pending'),
  exportBtn: document.getElementById('export-btn'),
  resetBtn: document.getElementById('reset-btn'),

  histTabs: document.getElementById('hist-tabs'),
  histPilotName: document.getElementById('hist-pilot-name'),
  histLapsCount: document.getElementById('hist-laps-count'),
  histLapsList: document.getElementById('hist-laps-list'),

  chronoPilotBtn: document.getElementById('chrono-pilot-btn'),
  chronoPilotName: document.getElementById('chrono-pilot-name'),
  chronoPilotList: document.getElementById('chrono-pilot-list'),

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
  pairingDisconnectBtn: document.getElementById('pairing-disconnect-btn'),
  pairingEjectedBanner: document.getElementById('pairing-ejected-banner'),
  pairingReclaimBtn: document.getElementById('pairing-reclaim-btn'),

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

  relaisCol: document.getElementById('relais-col'),
  relaisLabel: document.getElementById('relais-label'),
  relaisCountdown: document.getElementById('relais-countdown'),
  relaisRentreTag: document.getElementById('relais-rentre-tag'),
  pitBanner: document.getElementById('pit-banner'),

  rentreBanner: document.getElementById('rentre-banner'),
  rentreOverlay: document.getElementById('rentre-overlay'),
  rentreOverlayOk: document.getElementById('rentre-overlay-ok'),

  customAlertBanner: document.getElementById('custom-alert-banner'),
  customAlertBannerText: document.getElementById('custom-alert-banner-text'),
  customAlertOverlay: document.getElementById('custom-alert-overlay'),
  customAlertOverlayText: document.getElementById('custom-alert-overlay-text'),
  customAlertOverlayOk: document.getElementById('custom-alert-overlay-ok'),

  finishOverlay: document.getElementById('finish-overlay'),
  finishOverlayOk: document.getElementById('finish-overlay-ok'),

  pseudoOverlay: document.getElementById('pseudo-overlay'),
  pseudoForm: document.getElementById('pseudo-form'),
  pseudoInput: document.getElementById('pseudo-input'),

  appFrame: document.getElementById('app-frame'),
  navPosLeftBtn: document.getElementById('nav-pos-left-btn'),
  navPosRightBtn: document.getElementById('nav-pos-right-btn'),
  themeLightBtn: document.getElementById('theme-light-btn'),
  themeDarkBtn: document.getElementById('theme-dark-btn'),

  notifEnableBtn: document.getElementById('notif-enable-btn'),
  notifStatus: document.getElementById('notif-status'),

  soundRentre: document.getElementById('sound-rentre'),
  soundRentreTest: document.getElementById('sound-rentre-test'),
  soundFinish: document.getElementById('sound-finish'),
  soundFinishTest: document.getElementById('sound-finish-test'),
  soundAlarmAck: document.getElementById('sound-alarm-ack'),
  soundAlarmAckTest: document.getElementById('sound-alarm-ack-test'),
  soundCustomAlert: document.getElementById('sound-custom-alert'),
  soundCustomAlertTest: document.getElementById('sound-custom-alert-test'),
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
  // Coming back to Historique later should default to the current relay
  // again, not silently keep showing whatever was picked last visit.
  if (page === 'historique') histFollowCurrent = true;
  for (const [name, section] of Object.entries(el.pages)) {
    section.classList.toggle('hidden', name !== page);
  }
  for (const btn of el.navRail.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.page === page);
  }
  render();
}

// ---- Core actions (Phase A) ----

function recordLap() {
  if (!state.recording_active || state.ejected) return;
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
    pseudo: state.pseudo || null,
  };

  state.laps.push(lap);
  state.last_lap_ts = t;
  persist();
  render();
  flushLapQueue();
}

function startSession() {
  state.session_start_ts = now();
  state.recording_active = true;
  state.last_lap_ts = null;
  persist();
  render();
  showToast('Session démarrée.');
}

function resumeRecording() {
  state.recording_active = true;
  // A pause can last a while; resetting the reference point avoids the
  // next lap silently absorbing the paused duration.
  state.last_lap_ts = now();
  persist();
  render();
  showToast('Enregistrement repris.');
}

// The big round button is the only one that ever (re)starts things — like
// a real stopwatch's start/split button: Start before a session exists,
// Resume if paused, Lap once running. STOP only ever stops (pauseRecording).
function handleTourPress() {
  if (state.ejected) return;
  if (state.session_start_ts === null) {
    startSession();
    return;
  }
  if (!state.recording_active) {
    resumeRecording();
    return;
  }
  recordLap();
}

function undoLastLap() {
  const last = state.laps[state.laps.length - 1];
  // Only undo a lap that belongs to the current stint — after a pilot
  // change the Chrono page no longer shows the outgoing pilot's laps, so
  // there's nothing on screen to associate this action with.
  if (!last || last.id_relais_estime !== state.relais_estime_courant) return;
  state.laps.pop();
  state.synced_lap_ids = state.synced_lap_ids.filter((id) => id !== last.id_unique);
  state.last_lap_ts = state.laps.length
    ? state.laps[state.laps.length - 1].timestamp
    : null;
  persist();
  render();
  showToast('Dernier tour annulé.');
}

// Stops only — never resumes. Resuming is a TOUR press (handleTourPress).
function pauseRecording() {
  if (state.ejected) {
    showToast('Reprends la main avant de modifier l’enregistrement.');
    return;
  }
  if (!state.recording_active) return; // already stopped, nothing to do
  state.recording_active = false;
  persist();
  render();
  showToast('Enregistrement en pause.');
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
  // New pilot, new stint: the running "chrono en cours" and the next lap
  // must start clean, not inherit elapsed time from the previous pilot.
  if (state.recording_active) state.last_lap_ts = now();
  persist();
  render();
  showToast('Pilote : ' + (currentPilote()?.nom || ''));
}

function deletePilote(id) {
  const pilote = state.pilotes.find((p) => p.id === id);
  if (!pilote) return;
  if (id === state.pilote_courant_id) {
    showToast('Change de pilote avant de supprimer celui-ci.');
    return;
  }
  openConfirm(
    'Supprimer ce pilote ?',
    `${pilote.nom} sera retiré de la liste. Ses tours déjà enregistrés restent dans l'historique.`,
    () => {
      state.pilotes = state.pilotes.filter((p) => p.id !== id);
      persist();
      render();
      showToast('Pilote supprimé.');
    }
  );
}

function resetSession() {
  teardownCourseSubscription();
  alarmAckUnsubscribes.forEach((unsub) => unsub());
  alarmAckUnsubscribes.clear();
  lastFlashedRentreTs = null;
  lastFlashedCustomAlertTs = null;
  clearTimeout(alarmStatusAutoHideTimer);
  alarmStatusScheduledForId = null;
  alarmStatusDismissedForId = null;
  raceOverSignaled = false;
  raceOverDismissed = false;
  pairingEditMode = false;

  const keepPilotes = state.pilotes;
  const keepCurrent = state.pilote_courant_id;
  const keepPseudo = state.pseudo;
  state = createDefaultState();
  state.pilotes = keepPilotes;
  state.pilote_courant_id = keepCurrent;
  state.pseudo = keepPseudo;
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
  state.ejected = false;
  pairingEditMode = false;
  persist();
  render();
  subscribeToCourse();
  // Take over the "active mobile" slot for this course — this is what
  // evicts whoever else was paired on it (initial join, re-join, and the
  // "Reprendre la main" recovery button all go through here).
  transport.claimActiveMobile(code, { device_id: state.session_local_id, connected_ts: now() }).catch(() => {});
  showToast(`Course rejointe : ${code}`);
}

function changeCourse() {
  pairingEditMode = true;
  el.pairingCodeInput.value = state.id_course || '';
  render();
  el.pairingCodeInput.focus();
}

function disconnectCourse() {
  const code = state.id_course;
  const deviceId = state.session_local_id;
  teardownCourseSubscription();
  state.id_course = null;
  state.paired_ts = null;
  state.ejected = false;
  pairingEditMode = false;
  persist();
  render();
  if (code) transport.releaseActiveMobile(code, deviceId).catch(() => {});
  showToast('Déconnecté du réseau — les tours enregistrés restent en local.');
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
  // Just listen here — claiming the slot only happens on an explicit
  // joinCourse()/reclaim, never automatically on reload, or two phones
  // would keep evicting each other on every page refresh.
  activeMobileUnsubscribe = transport.listenActiveMobile(state.id_course, onActiveMobileChange);
  flushLapQueue();
}

function teardownCourseSubscription() {
  if (stateUnsubscribe) {
    stateUnsubscribe();
    stateUnsubscribe = null;
  }
  if (activeMobileUnsubscribe) {
    activeMobileUnsubscribe();
    activeMobileUnsubscribe = null;
  }
}

function onActiveMobileChange(val) {
  const ejected = !!val && val.device_id !== state.session_local_id;
  if (ejected === state.ejected) return;
  state.ejected = ejected;
  persist();
  render();
  if (ejected) {
    showToast('⚠ Un autre téléphone a pris le relais sur cette course.');
    vibrate([80, 60, 80]);
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

// Adopts the PC's current pilot without touching last_lap_ts: this is the
// PC correcting who's marked as current, not a stint change happening on
// the phone right now, so the running "chrono en cours" must keep ticking
// exactly as it was. Returns true if it actually changed anything.
function syncPiloteWithPc(nom) {
  const pilote = state.pilotes.find((p) => p.nom === nom);
  if (!pilote || pilote.id === state.pilote_courant_id) return false;
  state.pilote_courant_id = pilote.id;
  state.relais_estime_courant += 1;
  return true;
}

// Manual recovery from a bad manip on the phone — same sync as the
// automatic one in onPcState below, just triggered on demand.
function syncPiloteFromPc() {
  if (!state.pc_pilote_courant) {
    showToast('Aucune info pilote reçue du PC pour l’instant.');
    return;
  }
  if (!state.pilotes.some((p) => p.nom === state.pc_pilote_courant)) {
    showToast('Pilote PC inconnu localement : ' + state.pc_pilote_courant);
    return;
  }
  if (!syncPiloteWithPc(state.pc_pilote_courant)) {
    showToast('Déjà synchronisé avec le PC.');
    return;
  }
  persist();
  render();
  showToast('Pilote synchronisé : ' + state.pc_pilote_courant);
}

// The PC is authoritative: if it stopped, reset, or started a new race,
// the phone's own recording no longer corresponds to anything and must be
// wiped — laps, alarms, and the running chrono. Pilots list and pairing
// are kept (that's not "chronos", it's just who's available to pick).
function resetLocalRecordingFromPc() {
  state.laps = [];
  state.synced_lap_ids = [];
  state.alarms = [];
  state.session_start_ts = null;
  state.recording_active = false;
  state.last_lap_ts = null;
  state.relais_estime_courant = 1;
  state.pilote_courant_id = null;
  histSelRelais = null;
  histFollowCurrent = true;
  clearTimeout(alarmStatusAutoHideTimer);
  alarmStatusScheduledForId = null;
  alarmStatusDismissedForId = null;
  raceOverSignaled = false;
  raceOverDismissed = false;
  showToast('↺ Course réinitialisée sur le PC — chronos et historique remis à zéro.');
}

function onPcState(raw) {
  if (!raw) return; // nothing published yet — keep current fallback UI
  const pcRaceStartedAt = typeof raw.race_started_at === 'number' ? raw.race_started_at : null;
  if (state.pc_state_recv_ts !== null && pcRaceStartedAt !== state.pc_race_started_at) {
    resetLocalRecordingFromPc();
  }
  state.pc_race_started_at = pcRaceStartedAt;

  if (Array.isArray(raw.roster)) {
    mergePcRoster(raw.roster);
    state.pc_roster = raw.roster;
  }
  state.pc_pilote_courant = typeof raw.pilote_courant === 'string' ? raw.pilote_courant : null;
  if (state.pc_pilote_courant) {
    if (state.pilote_courant_id) syncPiloteWithPc(state.pc_pilote_courant);
    else adoptPcPiloteIfNone(state.pc_pilote_courant);
  }
  state.relais_snapshot = raw.relais || null;
  state.course_snapshot = raw.course || null;
  state.pause = !!raw.pause;
  state.rentre = raw.rentre || null;

  const pitActif = !!raw.pit_actif;
  // The bike is stopped in the pits: the lap in progress no longer means
  // anything, so pause exactly like a manual STOP. The human resumes with
  // TOUR once the new rider is actually back on track — never automatic,
  // since the pit workflow resolving doesn't mean the bike has left yet.
  if (pitActif && !state.pc_pit_actif && state.recording_active) {
    state.recording_active = false;
    showToast('⏸ Pit signalé par le PC — chrono en pause.');
  }
  state.pc_pit_actif = pitActif;
  state.pc_race_over = !!raw.race_over;
  state.custom_alert = raw.custom_alert || null;

  state.pc_state_recv_ts = now();
  persist();
  render();
  maybeSignalRentre();
  maybeSignalRaceOver();
  maybeSignalCustomAlert();
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
      playPreset(state.sound_prefs.alarm_ack);
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
  // What matters trackside isn't how long the phone has been open — it's
  // how much of the endurance race is left, as computed by the PC.
  const courseTimeLeft = (state.course_snapshot && typeof state.course_snapshot.fin_ts === 'number')
    ? formatDuration(Math.max(0, state.course_snapshot.fin_ts - now()))
    : '—';
  el.timerSession.textContent = courseTimeLeft;
  el.chronoSessionTime.textContent = courseTimeLeft;

  const pilote = currentPilote();
  el.pilotActuel.textContent = pilote ? pilote.nom : 'Aucun pilote sélectionné';
  el.chronoPilotName.textContent = pilote ? pilote.nom : 'Aucun pilote sélectionné';

  const lapRef = state.last_lap_ts ?? state.session_start_ts;
  el.currentLapValue.textContent = state.recording_active && !state.ejected && lapRef !== null
    ? formatDuration(now() - lapRef, { tenths: true })
    : '—';

  // The round button is the only one that (re)starts things — Start before
  // a session exists, Resume if paused, Lap once running. It's only ever
  // disabled when ejected: unlike before, "paused" is still a tappable
  // state here (that's how you resume).
  const started = state.session_start_ts !== null;
  const canPress = !state.ejected;
  el.tourBtn.disabled = !canPress;
  el.tourBtn.classList.toggle('paused', !canPress);
  el.tourBtnLabel.textContent = !started ? 'DÉMARRER' : state.recording_active ? 'TOUR' : 'REPRENDRE';
  el.tourBtnLabel.classList.toggle('tour-btn__label--start', !started || !state.recording_active);
  el.tourPausedTag.textContent = 'Déconnecté';
  el.tourPausedTag.classList.toggle('hidden', canPress);
  el.tourBtnHint.textContent = state.ejected
    ? 'Déconnecté — un autre téléphone a pris le relais'
    : !started
      ? 'Appuie pour démarrer le chrono'
      : state.recording_active
        ? 'Appuie à chaque passage sur la ligne'
        : 'En pause — appuie sur TOUR pour reprendre';

  // STOP only ever stops: enabled while actively recording, disabled
  // otherwise (nothing to stop before starting or while already paused).
  el.recordingToggleBtn.disabled = state.ejected || !started || !state.recording_active;
  el.recordingToggleBtn.textContent = 'STOP';

  // Derniers tours is scoped to the current stint: a pilot change starts a
  // new relais_estime_courant, so the outgoing pilot's laps drop off the
  // Chrono page (still fully available in Historique).
  const currentRelaisLaps = state.laps.filter((l) => l.id_relais_estime === state.relais_estime_courant);
  el.undoBtn.disabled = currentRelaisLaps.length === 0;
  el.lapsCount.textContent = currentRelaisLaps.length;

  const toursRestants = state.relais_snapshot && typeof state.relais_snapshot.tours_restants === 'number'
    ? state.relais_snapshot.tours_restants
    : null;
  el.toursRestantsValue.textContent = toursRestants !== null ? `≈ ${toursRestants}` : '—';

  renderLapsList();
  renderPending();
  renderPairing();
  renderPiloteList();
  renderChronoPilotList();
  renderConnectivity();
  renderRelais();
  renderDivergence();
  renderAlarmStatus();
  renderHistorique();
  el.navAlertDot.classList.toggle('hidden', !isRentreActive());
  el.pitBanner.classList.toggle('hidden', !state.pc_pit_actif);

  el.appFrame.classList.toggle('nav-right', state.nav_position === 'right');
  el.navPosLeftBtn.classList.toggle('current', state.nav_position !== 'right');
  el.navPosRightBtn.classList.toggle('current', state.nav_position === 'right');

  document.documentElement.setAttribute('data-theme', state.theme === 'dark' ? 'dark' : 'light');
  el.themeLightBtn.classList.toggle('current', state.theme !== 'dark');
  el.themeDarkBtn.classList.toggle('current', state.theme === 'dark');

  el.soundRentre.value = state.sound_prefs.rentre;
  el.soundFinish.value = state.sound_prefs.finish;
  el.soundAlarmAck.value = state.sound_prefs.alarm_ack;
  el.soundCustomAlert.value = state.sound_prefs.custom_alert;

  const needsPseudo = !state.pseudo;
  el.pseudoOverlay.classList.toggle('hidden', !needsPseudo);
  if (needsPseudo && document.activeElement !== el.pseudoInput) el.pseudoInput.focus();
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

// pilote_vu_tel is free-text the user typed as a pilot name, so this is
// built from DOM nodes + textContent rather than innerHTML.
function buildLapRow(lap, index) {
  const li = document.createElement('li');
  li.className = 'lap-row';

  const n = document.createElement('span');
  n.className = 'lap-row__n';
  n.textContent = String(index);

  const mid = document.createElement('div');
  mid.className = 'lap-row__mid';
  const t = document.createElement('div');
  t.className = 'lap-row__t';
  t.textContent = formatDuration(lap.valeur_chrono, { tenths: true });
  const pilot = document.createElement('div');
  pilot.className = 'lap-row__pilot';
  pilot.textContent = lap.pilote_vu_tel || '—';
  mid.appendChild(t);
  mid.appendChild(pilot);

  const d = new Date(lap.timestamp);
  const clock = document.createElement('span');
  clock.className = 'lap-row__clock';
  clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  li.appendChild(n);
  li.appendChild(mid);
  li.appendChild(clock);
  return li;
}

function renderLapsList() {
  el.lapsList.innerHTML = '';
  // Only the current stint's laps — a pilot change clears this list (the
  // full history stays available under Historique).
  const laps = state.laps.filter((l) => l.id_relais_estime === state.relais_estime_courant);
  if (laps.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'laps-empty';
    empty.textContent = 'Aucun tour enregistré pour ce relais.';
    el.lapsList.appendChild(empty);
    return;
  }
  laps.slice().reverse().forEach((lap, i) => {
    el.lapsList.appendChild(buildLapRow(lap, laps.length - i));
  });
}

// ---- Historique (per-relay lap history, mirrors the PC's segment tabs) ----

function relaisGroups() {
  const groups = new Map(); // id_relais_estime -> laps[]
  state.laps.forEach((lap) => {
    const key = lap.id_relais_estime ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lap);
  });
  // Always include the current relay, even with zero laps yet.
  if (!groups.has(state.relais_estime_courant)) groups.set(state.relais_estime_courant, []);
  return [...groups.keys()].sort((a, b) => a - b).map((id) => ({ id, laps: groups.get(id) }));
}

function renderHistorique() {
  const groups = relaisGroups();
  if (histFollowCurrent || !groups.some((g) => g.id === histSelRelais)) {
    histSelRelais = state.relais_estime_courant;
  }

  el.histTabs.innerHTML = '';
  groups.forEach((g) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hist-tab' + (g.id === histSelRelais ? ' current' : '');
    btn.textContent = `R${g.id} · ${g.laps.length} t`;
    btn.addEventListener('click', () => {
      histSelRelais = g.id;
      histFollowCurrent = g.id === state.relais_estime_courant;
      renderHistorique();
    });
    el.histTabs.appendChild(btn);
  });

  const sel = groups.find((g) => g.id === histSelRelais) || { id: histSelRelais, laps: [] };
  const pilotName = sel.laps.length
    ? sel.laps[0].pilote_vu_tel || '—'
    : (sel.id === state.relais_estime_courant ? (currentPilote()?.nom || '—') : '—');
  el.histPilotName.textContent = `R${sel.id} · ${pilotName}`;
  el.histLapsCount.textContent = sel.laps.length;

  el.histLapsList.innerHTML = '';
  if (sel.laps.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'laps-empty';
    empty.textContent = 'Aucun tour enregistré pour ce relais.';
    el.histLapsList.appendChild(empty);
    return;
  }
  sel.laps.forEach((lap, i) => {
    el.histLapsList.appendChild(buildLapRow(lap, i + 1));
  });
}

function renderPairing() {
  const joined = !!state.id_course && !pairingEditMode;
  el.pairingJoin.classList.toggle('hidden', joined);
  el.pairingJoined.classList.toggle('hidden', !joined);
  el.pairingCodeDisplay.textContent = state.id_course || '—';
  el.pairingEjectedBanner.classList.toggle('hidden', !(joined && state.ejected));
}

function pilotMarkSpan(cur) {
  const mark = document.createElement('span');
  mark.className = 'pilot-row-btn__mark';
  mark.textContent = cur ? '●' : '';
  return mark;
}

function pilotNameSpan(nom) {
  const name = document.createElement('span');
  name.className = 'pilot-row-btn__name';
  name.textContent = nom;
  return name;
}

// Course page: full management list — select or delete each pilot.
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
    const row = document.createElement('div');
    row.className = 'pilot-row' + (cur ? ' current' : '');

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'pilot-row__select';
    select.appendChild(pilotMarkSpan(cur));
    select.appendChild(pilotNameSpan(p.nom));
    select.addEventListener('click', () => selectPilote(p.id));
    row.appendChild(select);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pilot-row__delete';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Supprimer ' + p.nom);
    del.addEventListener('click', () => deletePilote(p.id));
    row.appendChild(del);

    el.pilotList.appendChild(row);
  });
}

// Chrono page: quick picker — tap a pilot to switch and close the list.
function renderChronoPilotList() {
  el.chronoPilotList.innerHTML = '';
  if (state.pilotes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-desc';
    empty.style.margin = '0';
    empty.textContent = 'Aucun pilote enregistré (ajoute-en un dans Course).';
    el.chronoPilotList.appendChild(empty);
    return;
  }
  state.pilotes.forEach((p) => {
    const cur = p.id === state.pilote_courant_id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pilot-row-btn' + (cur ? ' current' : '');
    btn.appendChild(pilotMarkSpan(cur));
    btn.appendChild(pilotNameSpan(p.nom));
    btn.addEventListener('click', () => {
      selectPilote(p.id);
      el.chronoPilotList.classList.add('hidden');
    });
    el.chronoPilotList.appendChild(btn);
  });
}

function renderRelais() {
  const snap = state.relais_snapshot;
  if (!snap || !snap.cible_fin_ts) {
    el.relaisCol.classList.remove('urgent', 'paused', 'overtime');
    el.relaisLabel.textContent = 'Fin de relais';
    el.relaisCountdown.textContent = '--:--';
    el.relaisRentreTag.classList.add('hidden');
    return;
  }
  const remainingMs = state.pause
    ? snap.cible_fin_ts - (state.pc_state_recv_ts ?? now())
    : snap.cible_fin_ts - now();
  const approx = snap.mode_alerte === 'tours';
  const active = isRentreActive();
  // Past the target: don't freeze at 0 — keep counting up so it's obvious
  // (and by how much) the rider is overdue.
  const overtime = remainingMs < 0;

  el.relaisCol.classList.toggle('urgent', active && !overtime);
  el.relaisCol.classList.toggle('overtime', overtime);
  el.relaisCol.classList.toggle('paused', state.pause && !active && !overtime);
  el.relaisRentreTag.classList.toggle('hidden', !active);
  el.relaisLabel.textContent = overtime
    ? 'Relais dépassé'
    : active
      ? 'Fin de relais'
      : state.pause
        ? 'Fin de relais (en pause)'
        : 'Fin de relais';

  if (overtime) {
    el.relaisCountdown.textContent = '+' + formatDuration(-remainingMs);
  } else if (approx) {
    // "tours restants" display per design spec — falls back to an
    // approximate time countdown if the PC hasn't published a tour count yet.
    el.relaisCountdown.textContent = typeof snap.tours_restants === 'number'
      ? `≈ ${snap.tours_restants}`
      : `≈ ${formatDuration(remainingMs)}`;
  } else {
    el.relaisCountdown.textContent = formatDuration(remainingMs);
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
  if (!last || alarmStatusDismissedForId === last.id_unique) {
    el.alarmStatus.classList.add('hidden');
    return;
  }
  el.alarmStatus.classList.remove('hidden', 'sending', 'acked', 'unsent');
  if (last.acked) {
    el.alarmStatus.innerHTML = '<span>✓</span><span>PC prévenu</span>';
    el.alarmStatus.classList.add('acked');
    // Resets back to idle a few seconds after the PC acks, instead of
    // leaving "PC prévenu" on screen indefinitely.
    if (alarmStatusScheduledForId !== last.id_unique) {
      alarmStatusScheduledForId = last.id_unique;
      clearTimeout(alarmStatusAutoHideTimer);
      alarmStatusAutoHideTimer = setTimeout(() => {
        alarmStatusDismissedForId = last.id_unique;
        render();
      }, 4000);
    }
  } else if (!state.id_course || !transport.isConfigured() || !transport.isConnected()) {
    el.alarmStatus.innerHTML = '<span>⚠</span><span>Non remis (réseau)</span>';
    el.alarmStatus.classList.add('unsent');
  } else {
    el.alarmStatus.innerHTML = '<span>◴</span><span>Envoi…</span>';
    el.alarmStatus.classList.add('sending');
  }
}

// Best-effort system notification for when the app is backgrounded (another
// tab/app in front, screen dimmed but not yet suspended). This can NOT wake
// a fully locked/suspended phone — that needs real Web Push from a server,
// which this app doesn't have. It only helps the "phone unlocked, app just
// not in front" case, which is still the most common one in practice.
function notifyBackground(title, body) {
  if (document.visibilityState !== 'hidden') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, { body, tag: title, renotify: true, icon: './icons/icon-192.png', vibrate: [200, 100, 200] });
  }).catch(() => {});
}

// True once the PC has an active "faire rentrer le pilote" signal AND the
// user hasn't already acked this specific instance of it (by ts). Acking
// resolves it everywhere immediately, without waiting on the PC round-trip.
function isRentreActive() {
  const r = state.rentre;
  return !!(r && r.actif && r.ts !== state.rentre_acked_ts);
}

function maybeSignalRentre() {
  if (!isRentreActive()) {
    el.rentreBanner.classList.add('hidden');
    return;
  }
  const r = state.rentre;
  el.rentreBanner.classList.remove('hidden');
  if (r.ts !== lastFlashedRentreTs) {
    lastFlashedRentreTs = r.ts;
    el.rentreOverlay.classList.remove('hidden');
    playPreset(state.sound_prefs.rentre);
    vibrate([200, 100, 200, 100, 400]);
    notifyBackground('Faire rentrer le pilote', 'Le PC demande de faire rentrer le pilote au stand.');
  }
}

function ackRentre() {
  const r = state.rentre;
  if (!r || !r.actif) return;
  state.rentre_acked_ts = r.ts;
  persist();
  el.rentreOverlay.classList.add('hidden');
  maybeSignalRentre(); // hides the banner immediately, doesn't wait on the PC
  if (state.id_course) transport.pushRentreAck(state.id_course, r.ts).catch(() => {});
}

// Same pattern as isRentreActive/maybeSignalRentre/ackRentre, but for a
// PC-defined custom alert with free text instead of the fixed "rentre" one.
function isCustomAlertActive() {
  const a = state.custom_alert;
  return !!(a && a.actif && a.ts !== state.custom_alert_acked_ts);
}

function maybeSignalCustomAlert() {
  if (!isCustomAlertActive()) {
    el.customAlertBanner.classList.add('hidden');
    return;
  }
  const a = state.custom_alert;
  el.customAlertBanner.classList.remove('hidden');
  el.customAlertBannerText.textContent = a.text;
  if (a.ts !== lastFlashedCustomAlertTs) {
    lastFlashedCustomAlertTs = a.ts;
    el.customAlertOverlayText.textContent = a.text;
    el.customAlertOverlay.classList.remove('hidden');
    playPreset(state.sound_prefs.custom_alert);
    vibrate([200, 100, 200, 100, 400]);
    notifyBackground('Alerte du PC', a.text);
  }
}

function ackCustomAlert() {
  const a = state.custom_alert;
  if (!a || !a.actif) return;
  state.custom_alert_acked_ts = a.ts;
  persist();
  el.customAlertOverlay.classList.add('hidden');
  maybeSignalCustomAlert();
  if (state.id_course) transport.pushCustomAlertAck(state.id_course, a.ts).catch(() => {});
}

// Mirrors the PC's "finish" screen (course terminée). No ack round-trip to
// the PC needed here — it's purely informational, dismissed locally, and
// re-armed whenever resetLocalRecordingFromPc() detects a new race attempt.
function isRaceOverActive() {
  return !!state.pc_race_over && !raceOverDismissed;
}

function maybeSignalRaceOver() {
  if (!isRaceOverActive()) {
    el.finishOverlay.classList.add('hidden');
    return;
  }
  el.finishOverlay.classList.remove('hidden');
  if (!raceOverSignaled) {
    raceOverSignaled = true;
    playPreset(state.sound_prefs.finish);
    vibrate([150, 80, 150, 80, 300]);
    notifyBackground('Course terminée', 'Va chercher les bières !');
  }
}

function ackRaceOver() {
  raceOverDismissed = true;
  el.finishOverlay.classList.add('hidden');
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

el.navPosLeftBtn.addEventListener('click', () => {
  state.nav_position = 'left';
  persist();
  render();
});
el.navPosRightBtn.addEventListener('click', () => {
  state.nav_position = 'right';
  persist();
  render();
});

el.themeLightBtn.addEventListener('click', () => {
  state.theme = 'light';
  persist();
  render();
});
el.themeDarkBtn.addEventListener('click', () => {
  state.theme = 'dark';
  persist();
  render();
});

function renderNotifStatus() {
  if (!('Notification' in window)) {
    el.notifEnableBtn.classList.add('hidden');
    el.notifStatus.textContent = 'Notifications non supportées par ce navigateur.';
    return;
  }
  if (Notification.permission === 'granted') {
    el.notifEnableBtn.classList.add('hidden');
    el.notifStatus.textContent = '✓ Notifications activées.';
  } else if (Notification.permission === 'denied') {
    el.notifEnableBtn.classList.add('hidden');
    el.notifStatus.textContent = '✕ Notifications bloquées — active-les dans les réglages du navigateur.';
  } else {
    el.notifEnableBtn.classList.remove('hidden');
    el.notifStatus.textContent = '';
  }
}
if ('Notification' in window) {
  el.notifEnableBtn.addEventListener('click', () => {
    Notification.requestPermission().then(renderNotifStatus);
  });
}
renderNotifStatus();

el.soundRentre.addEventListener('change', () => {
  state.sound_prefs.rentre = el.soundRentre.value;
  persist();
  playPreset(state.sound_prefs.rentre);
});
el.soundRentreTest.addEventListener('click', () => playPreset(state.sound_prefs.rentre));
el.soundFinish.addEventListener('change', () => {
  state.sound_prefs.finish = el.soundFinish.value;
  persist();
  playPreset(state.sound_prefs.finish);
});
el.soundFinishTest.addEventListener('click', () => playPreset(state.sound_prefs.finish));
el.soundAlarmAck.addEventListener('change', () => {
  state.sound_prefs.alarm_ack = el.soundAlarmAck.value;
  persist();
  playPreset(state.sound_prefs.alarm_ack);
});
el.soundAlarmAckTest.addEventListener('click', () => playPreset(state.sound_prefs.alarm_ack));
el.soundCustomAlert.addEventListener('change', () => {
  state.sound_prefs.custom_alert = el.soundCustomAlert.value;
  persist();
  playPreset(state.sound_prefs.custom_alert);
});
el.soundCustomAlertTest.addEventListener('click', () => playPreset(state.sound_prefs.custom_alert));

el.tourBtn.addEventListener('click', handleTourPress);
el.undoBtn.addEventListener('click', undoLastLap);
el.recordingToggleBtn.addEventListener('click', pauseRecording);
el.chronoPilotBtn.addEventListener('click', () => {
  el.chronoPilotList.classList.toggle('hidden');
});
el.syncPiloteBtn.addEventListener('click', syncPiloteFromPc);
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
el.pairingDisconnectBtn.addEventListener('click', disconnectCourse);
el.pairingReclaimBtn.addEventListener('click', () => joinCourse(state.id_course));
el.pairingScanBtn.addEventListener('click', openQrScan);
el.qrCancelBtn.addEventListener('click', closeQrScan);

el.settingsSaveBtn.addEventListener('click', saveSettings);
el.settingsClearBtn.addEventListener('click', clearSettings);

el.alarmBtn.addEventListener('pointerdown', startAlarmHold);
['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) =>
  el.alarmBtn.addEventListener(evt, cancelAlarmHold)
);

el.rentreOverlayOk.addEventListener('click', ackRentre);
el.finishOverlayOk.addEventListener('click', ackRaceOver);
el.customAlertOverlayOk.addEventListener('click', ackCustomAlert);

el.pseudoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = el.pseudoInput.value.trim();
  if (!value) return;
  state.pseudo = value;
  persist();
  render();
});
el.rentreBanner.addEventListener('click', () => el.rentreOverlay.classList.remove('hidden'));
el.customAlertBanner.addEventListener('click', () => el.customAlertOverlay.classList.remove('hidden'));

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
// Try connecting as soon as a config is available (default or saved),
// instead of waiting for the first pairing/push — so the status dot on
// the Accueil page reflects real connectivity right away.
transport.connectIfConfigured();
if (state.id_course) subscribeToCourse();
state.alarms.filter((a) => !a.acked).forEach((a) => listenAlarmAckIfNeeded(a));

goToPage('accueil');
render();
maybeSignalRentre(); // restore banner/flash if still active after a refresh
setInterval(render, 500);
setInterval(flushLapQueue, 6000);
setInterval(retryUnackedAlarms, 3000);
persist();
