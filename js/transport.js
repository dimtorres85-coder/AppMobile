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
const DEFAULT_FIREBASE_CONFIG = null; // TODO: paste the real firebaseConfig here

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
  await firebaseModules.set(firebaseModules.ref(db, `sessions/${idCourse}/laps/${lap.id_unique}`), lap);
}

export async function pushAlarm(idCourse, alarm) {
  if (!idCourse) throw new Error('Pas de course appairée.');
  const db = await ensureConnected();
  if (!db) throw new Error('Relais indisponible.');
  await firebaseModules.set(firebaseModules.ref(db, `sessions/${idCourse}/alarms/${alarm.id_unique}`), alarm);
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
