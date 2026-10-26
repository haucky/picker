// Sprachmodell-Zugriff für alle Features. Standard ist ein lokales Modell über Ollama am eigenen Computer (nichts
// verlässt das Gerät); Tinfoil Private Inference (verschlüsselt, Attestierung der Enclave über das offizielle SDK) ist
// Option B und muss eigens eingeschaltet werden – auch wenn ein Key eingetragen ist. Ist beides an, wird lokal zuerst
// versucht und nur bei nicht erreichbarem Server Tinfoil genommen. Ohne beides gibt es keine KI-Funktionen; die App
// funktioniert sonst normal. Der lokale Server wird erst angesprochen, wenn er in Settings eingeschaltet wurde (sonst
// fragt Chrome Leute ohne Ollama nach dem Zugriff aufs lokale Netzwerk).
//
// Zwei Stufen: „schnell“ (kurze Antworten, z. B. Korrektur, Fragen vergleichen) und „gut“ (Prompts auf Text).
// Einstellungen bleiben im Browser (localStorage); der Tinfoil-Key geht nur an Tinfoil. Das Tinfoil-SDK
// (vendor/tinfoil.js, ~400 KB) wird erst bei der ersten Tinfoil-Anfrage geladen.

const KEY_STORE = 'tinfoil-api-key';

export const TIERS = ['fast', 'good'];
export const TIER_LABEL = { fast: 'Schnell', good: 'Gut' };
const TIER_OF = { correct: 'fast', judge: 'fast', prompt: 'good' }; // Zweck → Stufe

export const DEFAULT_LOCAL_URL = 'http://localhost:11434';
/** Lokale Modelle (Ollama-Namen). Qwen 3.5: mehrsprachig, gutes Deutsch, laufen auf einem M3; „Thinking“ ist aus. */
export const DEFAULT_LOCAL = { fast: 'qwen3.5:4b', good: 'qwen3.5:9b' };
const CONTEXT = { fast: 2048, good: 8192 }; // Kontextfenster lokal (Tokens), siehe chatLocal
/** Tinfoil-Modelle (IDs aus dem Tinfoil-Katalog, der sich öfter ändert; aktuelle Liste: listModels('tinfoil')). */
export const DEFAULT_TINFOIL = { fast: 'gemma4-31b', good: 'deepseek-v4-1-flash' };
const TINFOIL_STORE = { fast: 'ai-model:correct', good: 'ai-model:prompt' }; // ältere Schlüssel weiterverwenden

const get = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const put = (k, v, d) => { try { if (v != null && v !== '' && v !== d) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* egal */ } };

export const localOn = () => get('ai-local-on') === '1';
export const setLocalOn = (on) => { put('ai-local-on', on ? '1' : ''); localOk = null; };
export const localUrl = () => (get('ai-local-url') || get('embed-url') || DEFAULT_LOCAL_URL).replace(/\/+$/, '');
export const setLocalUrl = (v) => { put('ai-local-url', String(v).trim().replace(/\/+$/, ''), DEFAULT_LOCAL_URL); localOk = null; };
export const localModel = (tier) => get('ai-local-model:' + tier) || DEFAULT_LOCAL[tier];
export const setLocalModel = (tier, v) => put('ai-local-model:' + tier, String(v).trim(), DEFAULT_LOCAL[tier]);

export const tinfoilOn = () => get('ai-tinfoil-on') === '1';
export const setTinfoilOn = (on) => put('ai-tinfoil-on', on ? '1' : '');
export const tinfoilModel = (tier) => get(TINFOIL_STORE[tier]) || DEFAULT_TINFOIL[tier];
export const setTinfoilModel = (tier, v) => put(TINFOIL_STORE[tier], String(v).trim(), DEFAULT_TINFOIL[tier]);

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

// Lokaler Server erreichbar? null = unbekannt (wird beim nächsten Aufruf versucht), false = zuletzt nicht erreichbar.
let localOk = null;
let localFailedAt = 0;
const RETRY_LOCAL = 60000;
const localUsable = () => localOn() && (localOk !== false || Date.now() - localFailedAt > RETRY_LOCAL);
const tinfoilUsable = () => tinfoilOn() && !!apiKey() && navigator.onLine;

/** Kann gerade angefragt werden (lokal eingeschaltet oder Tinfoil eingeschaltet mit Key und online)? */
export const llmAvailable = () => localUsable() || tinfoilUsable();

/** Welcher Anbieter als Nächstes gefragt wird: 'local' | 'tinfoil' | null. */
export const provider = () => (localUsable() ? 'local' : tinfoilUsable() ? 'tinfoil' : null);

/** Modell für einen Zweck ('correct' | 'prompt' | 'judge') bzw. eine Stufe beim gerade genutzten Anbieter (z. B. für Caches). */
export function modelFor(purpose) {
  const tier = TIER_OF[purpose] || purpose;
  return provider() === 'tinfoil' ? 'tinfoil:' + tinfoilModel(tier) : 'local:' + localModel(tier);
}

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

/** Verbindung schon vorab aufbauen, damit die erste Anfrage schnell ist (Tinfoil: Attestierung). */
export function warmUp() {
  if (provider() === 'tinfoil') getClient().catch(() => {});
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

/* ---------- Lokal (Ollama) ---------- */

/**
 * Chat über Ollama (/api/chat, ohne „Thinking“); mit onDelta gestreamt (NDJSON). `context` = Kontextfenster in Tokens:
 * ausdrücklich klein halten – sonst reserviert Ollama für manche Modelle (z. B. Qwen 3.5) riesige Kontexte, und der
 * Speicher eines Laptops läuft voll.
 */
async function chatLocal({ model, messages, maxTokens, temperature, context, signal, onDelta }) {
  let res;
  try {
    res = await fetch(localUrl() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages, stream: !!onDelta, think: false, keep_alive: '5m',
        options: { temperature, num_predict: maxTokens, num_ctx: context },
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new LLMError('no-local', `Lokaler KI-Server (${localUrl()}) nicht erreichbar`);
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new LLMError(res.status === 404 ? 'no-model' : 'local-error',
      res.status === 404 ? `Modell „${model}“ fehlt – im Terminal: ollama pull ${model}` : `Ollama: ${res.status} ${msg.slice(0, 200)}`);
  }
  if (!onDelta) return (await res.json()).message?.content ?? '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let out = '';
  for (;;) {
    const { value, done } = await abortable(reader.read(), signal);
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const d = JSON.parse(line).message?.content;
      if (d) { out += d; onDelta(d, out); }
    }
  }
  return out;
}

/** Modell auf dem lokalen Server aus dem Speicher nehmen (z. B. vor einer langen Prüfung mit einem anderen). */
export async function unloadLocal(model) {
  try {
    await fetch(localUrl() + '/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }),
    });
  } catch { /* egal */ }
}

/** Modelle auf dem lokalen Server (Namen). */
export async function listLocalModels({ signal } = {}) {
  const res = await fetch(localUrl() + '/api/tags', { signal });
  if (!res.ok) throw new Error('Ollama: ' + res.status);
  return ((await res.json()).models || []).map((m) => m.name).sort();
}

/* ---------- Tinfoil ---------- */

async function chatTinfoil({ model, messages, maxTokens, temperature, signal, onDelta }) {
  if (!navigator.onLine) throw new LLMError('offline', 'Offline');
  const c = await abortable(getClient(), signal);
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (onDelta) {
    let out = '';
    try {
      const stream = await abortable(c.chat.completions.create({ ...body, stream: true }, { signal }), signal);
      for await (const chunk of stream) {
        const d = chunk.choices?.[0]?.delta?.content;
        if (d) { out += d; onDelta(d, out); }
      }
      return out;
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (out) throw err;
      // Streaming ging gar nicht: einmal ohne versuchen
    }
    const text = await chatTinfoil({ model, messages, maxTokens, temperature, signal });
    onDelta(text, text);
    return text;
  }
  const res = await abortable(c.chat.completions.create(body, { signal }), signal);
  return res.choices?.[0]?.message?.content ?? '';
}

/* ---------- Gemeinsam ---------- */

/**
 * Eine Chat-Anfrage → Antworttext. Lokal zuerst (falls eingeschaltet), sonst bzw. bei nicht erreichbarem Server
 * Tinfoil (falls eingeschaltet).
 * opts: { system, user | messages, purpose ('correct' | 'prompt' | 'judge') bzw. tier ('fast' | 'good'),
 *         via ('local' | 'tinfoil': nur diesen Anbieter, z. B. zum Testen), model (überschreibt das der Stufe),
 *         maxTokens, temperature, context (Kontextfenster lokal, Standard je Stufe), timeout (ms), signal,
 *         onDelta(stück, bisher) – dann wird gestreamt }
 * Fehler: LLMError('no-ai'|'no-local'|'no-model'|'no-key'|'offline'), DOMException AbortError (signal) bzw.
 * TimeoutError (timeout), sonst API-Fehler.
 */
export async function chat({
  system, user, messages, purpose = 'correct', tier = TIER_OF[purpose] || 'fast', via, model, maxTokens = 256,
  temperature = 0.2, context = CONTEXT[tier], timeout = 0, signal, onDelta,
} = {}) {
  const signals = [signal, timeout ? AbortSignal.timeout(timeout) : null].filter(Boolean);
  const sig = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const msgs = messages || [system && { role: 'system', content: system }, { role: 'user', content: user }].filter(Boolean);
  const opts = { messages: msgs, maxTokens, temperature, signal: sig, onDelta };
  if (via === 'local' || (!via && localUsable())) {
    try {
      const out = await chatLocal({ ...opts, context, model: model || localModel(tier) });
      localOk = true;
      return out;
    } catch (err) {
      if (err?.code !== 'no-local' || via === 'local') throw err;
      localOk = false; // Server weg: eine Weile nicht mehr versuchen, ggf. Tinfoil
      localFailedAt = Date.now();
      if (!tinfoilUsable()) throw err;
    }
  }
  if (via === 'tinfoil' || tinfoilUsable()) return chatTinfoil({ ...opts, model: model || tinfoilModel(tier) });
  throw new LLMError('no-ai', 'Keine KI eingerichtet (Settings → KI)');
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
