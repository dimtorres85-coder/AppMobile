// Single source of truth for "current time". Every part of the app must
// call now() instead of Date.now() directly, so timing logic stays
// centralized and swappable (see §2 of the reference doc: never store a
// decrementing countdown, only timestamps recomputed from now()).
export function now() {
  return Date.now();
}
