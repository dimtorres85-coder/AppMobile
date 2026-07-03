// Transport layer — the only file that knows about the relay provider.
// Everything else in the app talks to the small interface exported here
// (pushLap, pushAlarm, listenAlarmAck, listenState, connectivity...) so
// swapping Firebase for another free-tier backend later never touches
// app.js. Best-effort only: every function fails soft (resolves/no-ops)
// when unconfigured or offline instead of throwing into app logic.

const CONFIG_KEY = 'trackside_transport_config_v1';
const FIREBASE_VERSION = '10.12.2';

// Baked-in fallback so the app works out of the box without pasting the
// config on every phone. A config saved locally (Réglages) always wins.
// Not a secret: Firebase web config is safe to expose client-side, access
// control is enforced by the Realtime Database security rules.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAs7Lo-yqRqGE-e7-85xuEn063bQeqPXDc",
  authDomain: "endurance-tsc.firebaseapp.com",
  databaseURL: "https://endurance-tsc-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "endurance-tsc",
  storageBucket: "endurance-tsc.firebasestorage.app",
  messagingSenderId: "720342518193",
  appId: "1:720342518193:web:636b11420dcb00e3165590",
};

let firebaseModules = null; // { initializeApp, getDatabase, ref, set, onValue, off }
let dbInstance = null;
let connectingPromise = null;
let connected = false;
const connectivityListeners = new Set();

export function loadTransportConfig() {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && typeof cfg === 'object' && cfg.databaseURL) return cfg;
    }
  } catch (err) {
    console.error('Config relais illisible.', err);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

export function saveTransportConfig(cfg) {
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  // Force a fresh connection next time something is sent/listened.
  dbInstance = null;
  connectingPromise = null;
}

export function clearTransportConfig() {
  window.localStorage.removeItem(CONFIG_KEY);
  dbInstance = null;
  connectingPromise = null;
  connected = false;
}

export function isConfigured() {
  return !!loadTransportConfig();
}

// Fire-and-forget: attempt a connection as soon as a config is available,
// instead of waiting for the first push/listen call. Lets the status dot
// reflect real connectivity right away, which is the only visible proof
// on a phone that the baked-in default config actually applies.
export function connectIfConfigured() {
  if (isConfigured()) ensureConnected().catch(() => {});
}

export function isConnected() {
  return connected;
}

export function onConnectivityChange(cb) {
  connectivityListeners.add(cb);
  return () => connectivityListeners.delete(cb);
}

function setConnected(value) {
  if (value === connected) return;
  connected = value;
  connectivityListeners.forEach((cb) => {
    try { cb(connected); } catch (err) { console.error(err); }
  });
}

async function ensureConnected() {
  if (dbInstance) return dbInstance;
  if (connectingPromise) return connectingPromise;

  const cfg = loadTransportConfig();
  if (!cfg) return null;

  connectingPromise = (async () => {
    try {
      const [{ initializeApp }, dbMod] = await Promise.all([
        import(/* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(/* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`),
      ]);
      firebaseModules = dbMod;
      const app = initializeApp(cfg);
      const db = dbMod.getDatabase(app);
      dbMod.onValue(dbMod.ref(db, '.info/connected'), (snap) => setConnected(!!snap.val()));
      dbInstance = db;
      return db;
    } catch (err) {
      console.error('Connexion au relais impossible (hors ligne ?).', err);
      dbInstance = null;
      setConnected(false);
      return null;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

export async function pushLap(idCourse, lap) {
  if (!idCourse) throw new Error('Pas de course appairée.');
  const db = await ensureConnected();
  if (!db) throw new Error('Relais indisponible.');
  // The app keeps valeur_chrono in ms internally (like every other timestamp
  // here), but the PC contract expects a plain number in seconds — convert
  // only on the wire, never in the locally stored/displayed lap.
  const wireLap = { ...lap, valeur_chrono: lap.valeur_chrono / 1000 };
  await firebaseModules.set(firebaseModules.ref(db, `sessions/${idCourse}/laps/${lap.id_unique}`), wireLap);
}

export async function pushAlarm(idCourse, alarm) {
  if (!idCourse) throw new Error('Pas de course appairée.');
  const db = await ensureConnected();
  if (!db) throw new Error('Relais indisponible.');
  await firebaseModules.set(firebaseModules.ref(db, `sessions/${idCourse}/alarms/${alarm.id_unique}`), alarm);
}

// Acks the PC's "rentre" (come back to pits) signal so it clears on both
// sides instead of staying active until the next stint starts.
export async function pushRentreAck(idCourse, ts) {
  if (!idCourse) throw new Error('Pas de course appairée.');
  const db = await ensureConnected();
  if (!db) throw new Error('Relais indisponible.');
  await firebaseModules.set(firebaseModules.ref(db, `sessions/${idCourse}/rentre_ack`), { ts });
}

// Acks a PC-defined custom alert, same round-trip pattern as pushRentreAck.
export async function pushCustomAlertAck(idCourse, ts) {
  if (!idCourse) throw new Error('Pas de course appairée.');
  const db = await ensureConnected();
  if (!db) throw new Error('Relais indisponible.');
  await firebaseModules.set(firebaseModules.ref(db, `sessions/${idCourse}/custom_alert_ack`), { ts });
}

// Returns an unsubscribe function. Silently no-ops if unconfigured.
export function listenAlarmAck(idCourse, idUnique, cb) {
  let liveUnsub = null;
  let cancelled = false;
  ensureConnected().then((db) => {
    if (!db || cancelled) return;
    const r = firebaseModules.ref(db, `sessions/${idCourse}/alarms/${idUnique}/ack`);
    const handler = (snap) => cb(snap.val());
    firebaseModules.onValue(r, handler);
    liveUnsub = () => firebaseModules.off(r, 'value', handler);
  });
  return () => {
    cancelled = true;
    if (liveUnsub) liveUnsub();
  };
}

// Returns an unsubscribe function. Silently no-ops if unconfigured.
export function listenState(idCourse, cb) {
  let liveUnsub = null;
  let cancelled = false;
  ensureConnected().then((db) => {
    if (!db || cancelled) return;
    const r = firebaseModules.ref(db, `sessions/${idCourse}/state`);
    const handler = (snap) => cb(snap.val());
    firebaseModules.onValue(r, handler);
    liveUnsub = () => firebaseModules.off(r, 'value', handler);
  });
  return () => {
    cancelled = true;
    if (liveUnsub) liveUnsub();
  };
}

// ---- Single active mobile per session ----
// Only one phone should be recording/pushing for a given course at a time.
// Claiming the slot overwrites whoever was there before (eviction); every
// paired phone listens to it to notice it got evicted.

export async function claimActiveMobile(idCourse, payload) {
  if (!idCourse) throw new Error('Pas de course appairée.');
  const db = await ensureConnected();
  if (!db) throw new Error('Relais indisponible.');
  await firebaseModules.set(firebaseModules.ref(db, `sessions/${idCourse}/active_mobile`), payload);
}

// Best-effort release: only clears the slot if it's still this device's
// claim, so it never wipes out a newer phone that has since taken over.
export async function releaseActiveMobile(idCourse, deviceId) {
  if (!idCourse) return;
  const db = await ensureConnected();
  if (!db) return;
  await firebaseModules.runTransaction(
    firebaseModules.ref(db, `sessions/${idCourse}/active_mobile`),
    (current) => (!current || current.device_id === deviceId ? null : current)
  );
}

// Returns an unsubscribe function. Silently no-ops if unconfigured.
export function listenActiveMobile(idCourse, cb) {
  let liveUnsub = null;
  let cancelled = false;
  ensureConnected().then((db) => {
    if (!db || cancelled) return;
    const r = firebaseModules.ref(db, `sessions/${idCourse}/active_mobile`);
    const handler = (snap) => cb(snap.val());
    firebaseModules.onValue(r, handler);
    liveUnsub = () => firebaseModules.off(r, 'value', handler);
  });
  return () => {
    cancelled = true;
    if (liveUnsub) liveUnsub();
  };
}
