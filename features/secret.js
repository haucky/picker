// Geheimnisse (z. B. API-Keys) verschlüsselt im Browser ablegen: AES-GCM mit einem nicht exportierbaren Schlüssel aus
// WebCrypto. Schlüssel und verschlüsselter Wert liegen in einer eigenen IndexedDB („vault-picker-secrets“); der
// Schlüssel selbst lässt sich nicht auslesen, nur von dieser Seite (Origin) zum Entschlüsseln benutzen. Im Klartext
// steht der Wert also weder in localStorage noch in IndexedDB. Schutzgrenze: Code, der auf dieser Seite läuft, kann ihn
// trotzdem entschlüsseln – gegen Auslesen der Browser-Dateien bzw. Kopieren des Speichers hilft es.

const DB = 'vault-picker-secrets';
const STORE = 's';
const KEY_ID = '__key';

let dbP = null;
function db() {
  if (!dbP) {
    dbP = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbP.catch(() => { dbP = null; });
  }
  return dbP;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const idbGet = (k) => tx('readonly', (s) => s.get(k));
const idbPut = (k, v) => tx('readwrite', (s) => s.put(v, k));
const idbDel = (k) => tx('readwrite', (s) => s.delete(k));

/** Nicht exportierbarer AES-Schlüssel dieser Seite (beim ersten Mal erzeugt). */
async function cryptoKey(create) {
  let key = await idbGet(KEY_ID);
  if (!key && create) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idbPut(KEY_ID, key);
  }
  return key || null;
}

/** Gespeicherten Wert entschlüsselt holen ('' = keiner bzw. nicht lesbar). */
export async function loadSecret(name) {
  try {
    const rec = await idbGet('v:' + name);
    if (!rec) return '';
    const key = await cryptoKey(false);
    if (!key) return '';
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.data);
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
}

/** Wert verschlüsselt speichern; leer = löschen. */
export async function saveSecret(name, value) {
  const v = String(value || '').trim();
  if (!v) return idbDel('v:' + name);
  const key = await cryptoKey(true);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(v));
  await idbPut('v:' + name, { iv, data });
}
