import { now } from './now.js';
import { generateId, loadState, saveState, createDefaultState } from './storage.js';

let state = loadState();
let confirmCallback = null;

const el = {
  timerSession: document.getElementById('timer-session'),
  pilotActuel: document.getElementById('pilote-actuel'),
  tourBtn: document.getElementById('tour-btn'),
  tourBtnHint: document.getElementById('tour-btn-hint'),
  lastLapValue: document.getElementById('last-lap-value'),
  recordingToggleBtn: document.getElementById('recording-toggle-btn'),
  recordingStatus: document.getElementById('recording-status'),
  undoBtn: document.getElementById('undo-btn'),
  lapsList: document.getElementById('laps-list'),
  lapsCount: document.getElementById('laps-count'),
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

// ---- Core actions ----

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
}

function undoLastLap() {
  if (state.laps.length === 0) return;
  state.laps.pop();
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePiloteModal();
    closeConfirm();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.error('Enregistrement du service worker échoué', err);
    });
  });
}

render();
setInterval(render, 500);
persist();
