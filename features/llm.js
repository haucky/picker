// Sprachmodell-Zugriff für alle Features: Tinfoil Private Inference (OpenAI-kompatibel) über das offizielle SDK,
// das vor jeder Anfrage die Attestierung der Enclave prüft und Anfragen Ende-zu-Ende verschlüsselt.
// Der API-Key gibt jeder Nutzer selbst unter Settings ein; er bleibt im Browser (localStorage) und geht nur an
// Tinfoil. Das SDK (vendor/tinfoil.js, ~400 KB) wird erst bei der ersten Anfrage geladen.

const KEY_STORE = 'tinfoil-api-key';

/** Modelle (IDs aus dem Tinfoil-Katalog, der sich öfter ändert – bei Fehlern „model not found“ hier anpassen). */
export const MODELS = {
  fast: 'gemma4-31b', // schnell, ohne Thinking (Gemma denkt nur, wenn es im System-Prompt eingeschaltet wird)
};

export class LLMError extends Error {
  constructor(code, message) { super(message || code); this.name = 'LLMError'; this.code = code; }
}

export function apiKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}

export function setApiKey(key) {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORE, key.trim()); else localStorage.removeItem(KEY_STORE);
  } catch { /* egal */ }
}

/** Kann gerade angefragt werden (Key vorhanden und online)? */
export const llmAvailable = () => !!apiKey() && navigator.onLine;

let client = null;    // Promise<TinfoilAI> für clientKey
let clientKey = null;

function getClient() {
  const key = apiKey();
  if (!key) return Promise.reject(new LLMError('no-key', 'Kein Tinfoil-API-Key (Settings)'));
  if (!client || clientKey !== key) {
    clientKey = key;
    client = import('../vendor/tinfoil.js').then(async ({ TinfoilAI }) => {
      // Der Key gehört dem Nutzer selbst und steht nicht im ausgelieferten Code, daher ist der Browser hier in Ordnung.
      const c = new TinfoilAI({ apiKey: key, dangerouslyAllowBrowser: true });
      await c.ready(); // Attestierung prüfen (einmal pro Client)
      return c;
    });
    client.catch(() => { if (clientKey === key) client = null; }); // beim nächsten Mal neu versuchen
  }
  return client;
}

/** Verbindung und Attestierung schon vorab aufbauen, damit die erste Anfrage schnell ist. */
export function warmUp() {
  if (llmAvailable()) getClient().catch(() => {});
}

/** Promise, das bei Abbruch von `signal` sofort mit dessen Grund (AbortError/TimeoutError) abgelehnt wird. */
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Eine Chat-Anfrage → Antworttext.
 * opts: { system, user | messages, model (Standard MODELS.fast), maxTokens, temperature, timeout (ms), signal }
 * Fehler: LLMError('no-key'|'offline'), DOMException AbortError (signal) bzw. TimeoutError (timeout), sonst SDK-/API-Fehler.
 */
export async function chat({ system, user, messages, model = MODELS.fast, maxTokens = 256, temperature = 0.2, timeout = 0, signal } = {}) {
  if (!navigator.onLine) throw new LLMError('offline', 'Offline');
  const signals = [signal, timeout ? AbortSignal.timeout(timeout) : null].filter(Boolean);
  const sig = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const c = await abortable(getClient(), sig);
  const msgs = messages || [system && { role: 'system', content: system }, { role: 'user', content: user }].filter(Boolean);
  const res = await abortable(
    c.chat.completions.create({ model, messages: msgs, max_tokens: maxTokens, temperature }, { signal: sig }), sig);
  return res.choices?.[0]?.message?.content ?? '';
}

/** Erstes JSON-Array bzw. -Objekt aus einer Modellantwort (auch in ```json-Blöcken oder mit Text drumherum), sonst null. */
export function extractJSON(text) {
  const s = String(text || '');
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const start = s.indexOf(open);
    if (start < 0) continue;
    // vom letzten passenden Schluss-Zeichen rückwärts, bis ein Stück sich parsen lässt
    for (let end = s.lastIndexOf(close); end > start; end = s.lastIndexOf(close, end - 1)) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch { /* weiter */ }
    }
  }
  return null;
}
