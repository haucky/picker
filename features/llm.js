// Sprachmodell-Zugriff für alle Features: Tinfoil Private Inference (OpenAI-kompatibel) über das offizielle SDK,
// das vor jeder Anfrage die Attestierung der Enclave prüft und Anfragen Ende-zu-Ende verschlüsselt.
// Der API-Key gibt jeder Nutzer selbst unter Settings ein; er bleibt im Browser (localStorage) und geht nur an
// Tinfoil. Das SDK (vendor/tinfoil.js, ~400 KB) wird erst bei der ersten Anfrage geladen.

const KEY_STORE = 'tinfoil-api-key';

/**
 * Modell pro Zweck (IDs aus dem Tinfoil-Katalog, der sich öfter ändert). In Settings änderbar; die Liste der
 * aktuell verfügbaren Modelle liefert listModels().
 */
export const DEFAULT_MODELS = {
  correct: 'gemma4-31b',          // Korrekturvorschläge: schnell, ohne Thinking
  prompt: 'deepseek-v4-1-flash',  // Prompts auf markierten Text: stärker, trotzdem schnell
};
const MODEL_STORE = 'ai-model:';

export function modelFor(purpose) {
  try { return localStorage.getItem(MODEL_STORE + purpose) || DEFAULT_MODELS[purpose]; } catch { return DEFAULT_MODELS[purpose]; }
}

export function setModel(purpose, id) {
  try {
    if (id.trim() && id.trim() !== DEFAULT_MODELS[purpose]) localStorage.setItem(MODEL_STORE + purpose, id.trim());
    else localStorage.removeItem(MODEL_STORE + purpose);
  } catch { /* egal */ }
}

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
 * opts: { system, user | messages, model (ID) | purpose (siehe DEFAULT_MODELS), maxTokens, temperature, timeout (ms),
 *         signal, onDelta(stück, bisher) – dann wird gestreamt }
 * Fehler: LLMError('no-key'|'offline'), DOMException AbortError (signal) bzw. TimeoutError (timeout), sonst SDK-/API-Fehler.
 */
export async function chat({
  system, user, messages, purpose = 'correct', model = modelFor(purpose), maxTokens = 256, temperature = 0.2, timeout = 0,
  signal, onDelta,
} = {}) {
  if (!navigator.onLine) throw new LLMError('offline', 'Offline');
  const signals = [signal, timeout ? AbortSignal.timeout(timeout) : null].filter(Boolean);
  const sig = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const c = await abortable(getClient(), sig);
  const msgs = messages || [system && { role: 'system', content: system }, { role: 'user', content: user }].filter(Boolean);
  const body = { model, messages: msgs, max_tokens: maxTokens, temperature };
  if (onDelta) {
    let out = '';
    try {
      const stream = await abortable(c.chat.completions.create({ ...body, stream: true }, { signal: sig }), sig);
      for await (const chunk of stream) {
        const d = chunk.choices?.[0]?.delta?.content;
        if (d) { out += d; onDelta(d, out); }
      }
      return out;
    } catch (err) {
      if (sig?.aborted) throw sig.reason;
      if (out) throw err;
      // Streaming ging gar nicht: einmal ohne versuchen
    }
    const text = await chat({ system, user, messages, model, maxTokens, temperature, signal: sig });
    onDelta(text, text);
    return text;
  }
  const res = await abortable(c.chat.completions.create(body, { signal: sig }), sig);
  return res.choices?.[0]?.message?.content ?? '';
}

/** IDs der Modelle, die Tinfoil gerade anbietet (sortiert). */
export async function listModels({ signal } = {}) {
  const c = await abortable(getClient(), signal);
  const page = await abortable(c.models.list(), signal);
  return (page.data || []).map((m) => m.id).sort();
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
