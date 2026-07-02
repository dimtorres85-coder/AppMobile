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
    // True once another phone has claimed sessions/{id}/active_mobile —
    // blocks recording locally until this phone reclaims it.
    ejected: false,

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
    pc_pit_actif: false,
    pc_race_over: false,
    // Identifies the PC's current race attempt (null = none). Any change
    // once we've already seen a value means the PC stopped, reset, or
    // started a new race — the phone's own recording is wiped to match,
    // since the PC is the source of truth for "is a race happening".
    pc_race_started_at: null,
    // Locally acknowledged "rentre" alert timestamp — hides the alert as
    // soon as the user taps OK without waiting for the PC round-trip.
    rentre_acked_ts: null,

    // Display preference (device-local, not synced).
    nav_position: 'left',
    // Sound preset per alert type (device-local, not synced — each phone
    // picks whatever cuts through its own trackside noise best).
    sound_prefs: { rentre: 'strident', finish: 'doux', alarm_ack: 'simple' },
  };
}

// Merge saved data over a fresh default state so fields added by a newer
// version of the app (e.g. Phase B additions) are never missing from a
// session saved by an older version — avoids ever wiping local data.
function withDefaults(parsed) {
  const base = createDefaultState();
  const merged = { ...base, ...parsed };
  merged.session_local_id = parsed.session_local_id || base.session_local_id;
  merged.sound_prefs = { ...base.sound_prefs, ...(parsed.sound_prefs || {}) };
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
