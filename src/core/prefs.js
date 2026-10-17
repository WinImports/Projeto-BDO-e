// Preferências de interface (não críticas) em localStorage.
const PREFIX = 'bdoe.pref.';

export function getPref(name, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + name);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function setPref(name, value) {
  try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); } catch { /* ignora */ }
}
