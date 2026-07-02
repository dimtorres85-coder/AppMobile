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

    // Pairing (§16.3)
    id_course: null,
    paired_ts: null,

    created_ts: t,
    session_start_ts: null,
    recording_active: false,
    pilotes: [],
    pilote_courant_id: null,
    relais_estime_courant: 1,
    last_lap_ts: null,
    laps: [],

    // Send queue bookkeeping (§16.6) — which laps got a confirmed write.
    synced_lap_ids: [],

    // Alarm history (§16.7) — kept short, most recent last.
    alarms: [],

    // Best-effort cache of the last state published by the PC (§16.8).
    pc_roster: [],
    pc_pilote_courant: null,
    pc_state_recv_ts: null,
    relais_snapshot: null,
    course_snapshot: null,
    pause: false,
    rentre: null,
  };
}

// Merge saved data over a fresh default state so fields added by a newer
// version of the app (e.g. Phase B additions) are never missing from a
// session saved by an older version — avoids ever wiping local data.
function withDefaults(parsed) {
  const base = createDefaultState();
  const merged = { ...base, ...parsed };
  merged.session_local_id = parsed.session_local_id || base.session_local_id;
  return merged;
}

export function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultState();
    }
    return withDefaults(parsed);
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
