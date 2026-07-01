import { now } from './now.js';

const STORAGE_KEY = 'trackside_mobile_session_v1';

export function generateId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  // Fallback for browsers without crypto.randomUUID (older WebViews).
  return 'id-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createDefaultState() {
  const t = now();
  return {
    version: 1,
    session_local_id: generateId(),
    id_course: null,
    created_ts: t,
    session_start_ts: t,
    recording_active: true,
    pilotes: [],
    pilote_courant_id: null,
    relais_estime_courant: 1,
    last_lap_ts: null,
    laps: [],
  };
}

export function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return createDefaultState();
    }
    return parsed;
  } catch (err) {
    console.error('Lecture de la session locale impossible, nouvelle session créée.', err);
    return createDefaultState();
  }
}

export function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Sauvegarde locale impossible (stockage plein ?).', err);
  }
}
