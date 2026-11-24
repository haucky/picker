// Sprachmodell-Zugriff für alle Features. Mehrere Anbieter hinter einer gemeinsamen Schnittstelle (PROVIDERS, s. u.);
// gefragt wird der erste nutzbare in ORDER, bei „nicht erreichbar“ der nächste. Einen Anbieter tauschen oder ergänzen
// heißt: ein Objekt mit dieser Schnittstelle schreiben und in PROVIDERS/ORDER eintragen – die Features merken davon nichts.
//
//   1. Claude (Anthropic, https://api.anthropic.com, native Messages-API): Vorrang, sobald ein Claude-API-Key
//      gespeichert ist (verschlüsselt über secret.js) und das Gerät online ist; abschaltbar in Settings.
//   2. Lokal über Ollama am eigenen Computer (nichts verlässt das Gerät). Wird erst angesprochen, wenn in Settings
//      eingeschaltet (sonst fragt Chrome Leute ohne Ollama nach dem Zugriff aufs lokale Netzwerk).
//   3. Tinfoil Private Inference (verschlüsselt, Attestierung der Enclave über das offizielle SDK); muss eigens
//      eingeschaltet werden – auch wenn ein Key eingetragen ist. Das SDK (vendor/tinfoil.js, ~400 KB) wird erst bei der
//      ersten Tinfoil-Anfrage geladen.
// Ohne alles gibt es keine KI-Funktionen; die App funktioniert sonst normal.
//
// Zwei Stufen: „schnell“ (kurze Antworten, z. B. Korrektur, Fragen vergleichen) und „gut“ (Prompts auf Text,
// KI-Aktionen an einer Frage). Einstellungen bleiben im Browser (localStorage); Keys gehen nur an ihren Anbieter.

import { loadSecret, saveSecret } from './secret.js';

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
export const setLocalOn = (on) => { put('ai-local-on', on ? '1' : ''); localReach.reset(); };
export const localUrl = () => (get('ai-local-url') || get('embed-url') || DEFAULT_LOCAL_URL).replace(/\/+$/, '');
export const setLocalUrl = (v) => { put('ai-local-url', String(v).trim().replace(/\/+$/, ''), DEFAULT_LOCAL_URL); localReach.reset(); };
export const localModel = (tier) => get('ai-local-model:' + tier) || DEFAULT_LOCAL[tier];
export const setLocalModel = (tier, v) => put('ai-local-model:' + tier, String(v).trim(), DEFAULT_LOCAL[tier]);

/** Claude-Modelle je Stufe (IDs der Anthropic-API). */
export const DEFAULT_CLAUDE = { fast: 'claude-haiku-5-5', good: 'claude-opus-5-5' };
export const claudeOn = () => get('ai-claude-off') !== '1';
export const setClaudeOn = (on) => { put('ai-claude-off', on ? '' : '1'); claudeReach.reset(); };
export const claudeModel = (tier) => get('ai-claude-model:' + tier) || DEFAULT_CLAUDE[tier];
export const setClaudeModel = (tier, v) => put('ai-claude-model:' + tier, String(v).trim(), DEFAULT_CLAUDE[tier]);

// Claude-API-Key: verschlüsselt in IndexedDB (secret.js), entschlüsselt nur im Speicher. Früher unter „openai-api-key“.
const CLAUDE_KEY = 'claude-api-key';
let claudeKeyValue = '';
const claudeKeyReady = (async () => {
  let v = await loadSecret(CLAUDE_KEY);
  if (!v && (v = await loadSecret('openai-api-key'))) {
    await saveSecret(CLAUDE_KEY, v).catch(() => {});
    await saveSecret('openai-api-key', '').catch(() => {});
  }
  claudeKeyValue = v;
})().catch(() => {});
/** Ist ein Key gespeichert? (nach dem Laden; vorher ggf. noch false) */
export const hasClaudeKey = () => !!claudeKeyValue;
export const claudeKeyLoaded = () => claudeKeyReady;
export async function setClaudeKey(v) {
  claudeKeyValue = String(v || '').trim();
  claudeReach.reset();
  await saveSecret(CLAUDE_KEY, claudeKeyValue);
}

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

/**
 * Erreichbarkeit eines Anbieters merken: nach „nicht erreichbar“ eine Weile überspringen (dann der nächste in ORDER),
 * danach wieder versuchen.
 */
function reachability(retryMs) {
  let ok = null; // null = unbekannt, true = zuletzt erreichbar, false = zuletzt nicht
  let failedAt = 0;
  return {
    usable: () => ok !== false || Date.now() - failedAt > retryMs,
    up: () => { ok = true; },
    down: () => { ok = false; failedAt = Date.now(); },
    reset: () => { ok = null; },
  };
}
const localReach = reachability(60000);
const claudeReach = reachability(30000);
const tinfoilReach = reachability(30000);

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
  active()?.warmUp?.();
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
    throw new LLMError('unreachable', `Lokaler KI-Server (${localUrl()}) nicht erreichbar`);
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

/* ---------- Claude (Anthropic, native Messages-API) ---------- */

const CLAUDE_URL = 'https://api.anthropic.com/v1';
const CLAUDE_VERSION = '2026-10-21';
/**
 * Zusätze je Stufe. Schnell: ohne Thinking (Haiku erlaubt das abzuschalten). Gut: Thinking an (adaptiv, Standard-Effort
 * des Modells); dafür bekommt die Antwort Platz zum Nachdenken zusätzlich zu maxTokens. Kein temperature – ab API-Version
 * 2026-10-21 lehnt die API es ab.
 */
const CLAUDE_TIER = {
  fast: { body: { thinking: { type: 'disabled' } }, thinkRoom: 0 },
  good: { body: {}, thinkRoom: 8000 },
};

async function claudeHeaders() {
  await claudeKeyReady;
  if (!claudeKeyValue) throw new LLMError('no-key', 'Kein Claude-API-Key (Settings → KI)');
  return {
    'Content-Type': 'application/json',
    'x-api-key': claudeKeyValue,
    'anthropic-version': CLAUDE_VERSION,
    // Ohne diesen Header verweigert die API Anfragen direkt aus dem Browser (CORS). Der Key gehört dem Nutzer selbst
    // und steht nicht im ausgelieferten Code.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** Fehlerantwort der API → LLMError (401/403: Key; 429/5xx/529: gerade nicht nutzbar → nächster Anbieter). */
async function claudeError(res) {
  let msg = '';
  try { msg = (await res.json()).error?.message || ''; } catch { /* egal */ }
  const s = res.status;
  if (s === 401 || s === 403) return new LLMError('no-key', 'Claude-API-Key ungültig (Settings → KI)');
  if (s === 404) return new LLMError('no-model', 'Claude: Modell unbekannt – ' + msg);
  if (s === 429 || s >= 500) return new LLMError('unreachable', `Claude gerade nicht verfügbar (${s}) ${msg}`);
  return new LLMError('claude-error', `Claude: ${s} ${msg}`.slice(0, 300));
}

/** Modell-IDs, die die API anbietet. */
export async function listClaudeModels({ signal } = {}) {
  const res = await fetch(CLAUDE_URL + '/models?limit=100', { headers: await claudeHeaders(), signal });
  if (!res.ok) throw await claudeError(res);
  return ((await res.json()).data || []).map((m) => m.id);
}

async function chatClaude({ model, tier, messages, maxTokens, signal, onDelta }) {
  // Systemnachrichten gehen bei Claude ins Feld „system“, nicht in messages.
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const conv = messages.filter((m) => m.role !== 'system');
  const t = CLAUDE_TIER[tier] || CLAUDE_TIER.fast;
  const body = { model, max_tokens: maxTokens + t.thinkRoom, messages: conv, ...t.body, stream: !!onDelta };
  if (system) body.system = system;
  const headers = await claudeHeaders();
  let res;
  try {
    res = await fetch(CLAUDE_URL + '/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new LLMError('unreachable', 'Claude nicht erreichbar');
  }
  if (!res.ok) throw await claudeError(res);
  const refused = () => new LLMError('refused', 'Claude hat die Anfrage abgelehnt');
  if (!onDelta) {
    const msg = await res.json();
    if (msg.stop_reason === 'refusal') throw refused();
    return (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  // Server-Sent Events: nur text_delta zählt (Thinking-Blöcke werden übergangen)
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
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        out += ev.delta.text;
        onDelta(ev.delta.text, out);
      } else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') {
        throw refused();
      } else if (ev.type === 'error') {
        throw new LLMError(/overloaded|rate/i.test(ev.error?.type || '') && !out ? 'unreachable' : 'claude-error',
          'Claude: ' + (ev.error?.message || ev.error?.type || 'Fehler'));
      }
    }
  }
  return out;
}

/* ---------- Tinfoil ---------- */

async function chatTinfoil({ model, messages, maxTokens, temperature, signal, onDelta }) {
  if (!navigator.onLine) throw new LLMError('unreachable', 'Offline');
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

/* ---------- Anbieter (gemeinsame Schnittstelle) ---------- */

/**
 * Jeder Anbieter: {
 *   id, label,
 *   usable(): jetzt anfragen? (eingeschaltet, eingerichtet, nicht gerade als unerreichbar gemerkt),
 *   model(tier): Modell der Stufe,
 *   chat({ model, tier, messages, maxTokens, temperature, context, signal, onDelta }) → Antworttext
 *     (wirft LLMError('unreachable') wenn der Anbieter gerade nicht geht → nächster in ORDER),
 *   reach: reachability(), warmUp?() }
 * messages im Chat-Format [{ role: 'system'|'user'|'assistant', content }]; jeder Anbieter setzt sie selbst um.
 */
const PROVIDERS = {
  claude: {
    id: 'claude', label: 'Claude',
    usable: () => claudeOn() && !!claudeKeyValue && navigator.onLine && claudeReach.usable(),
    model: claudeModel, chat: chatClaude, reach: claudeReach,
  },
  local: {
    id: 'local', label: 'Lokal (Ollama)',
    usable: () => localOn() && localReach.usable(),
    model: localModel, chat: chatLocal, reach: localReach,
  },
  tinfoil: {
    id: 'tinfoil', label: 'Tinfoil',
    usable: () => tinfoilOn() && !!apiKey() && navigator.onLine && tinfoilReach.usable(),
    model: tinfoilModel, chat: chatTinfoil, reach: tinfoilReach,
    warmUp: () => getClient().catch(() => {}),
  },
};
/** Reihenfolge: der erste nutzbare wird gefragt, bei „nicht erreichbar“ der nächste. */
const ORDER = ['claude', 'local', 'tinfoil'];

const active = () => ORDER.map((id) => PROVIDERS[id]).find((p) => p.usable()) || null;

/** Kann gerade angefragt werden (irgendein Anbieter eingerichtet und nutzbar)? */
export const llmAvailable = () => !!active();

/** Welcher Anbieter als Nächstes gefragt wird: 'claude' | 'local' | 'tinfoil' | null. */
export const provider = () => active()?.id ?? null;

/** Modell für einen Zweck ('correct' | 'prompt' | 'judge') bzw. eine Stufe beim gerade genutzten Anbieter (z. B. für Caches). */
export function modelFor(purpose) {
  const tier = TIER_OF[purpose] || purpose;
  const p = active() || PROVIDERS.local;
  return p.id + ':' + p.model(tier);
}

/**
 * Eine Chat-Anfrage → Antworttext. Der erste nutzbare Anbieter in ORDER; ist er nicht erreichbar, der nächste.
 * opts: { system, user | messages, purpose ('correct' | 'prompt' | 'judge') bzw. tier ('fast' | 'good'),
 *         via ('claude' | 'local' | 'tinfoil': nur diesen Anbieter, z. B. zum Testen), model (überschreibt das der Stufe),
 *         maxTokens, temperature (wo unterstützt), context (Kontextfenster lokal, Standard je Stufe), timeout (ms),
 *         signal, onDelta(stück, bisher) – dann wird gestreamt }
 * Fehler: LLMError('no-ai'|'unreachable'|'no-model'|'no-key'|'refused'|…), DOMException AbortError (signal) bzw.
 * TimeoutError (timeout), sonst API-Fehler.
 */
export async function chat({
  system, user, messages, purpose = 'correct', tier = TIER_OF[purpose] || 'fast', via, model, maxTokens = 256,
  temperature = 0.2, context = CONTEXT[tier], timeout = 0, signal, onDelta,
} = {}) {
  const signals = [signal, timeout ? AbortSignal.timeout(timeout) : null].filter(Boolean);
  const sig = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const msgs = messages || [system && { role: 'system', content: system }, { role: 'user', content: user }].filter(Boolean);
  const candidates = via ? [PROVIDERS[via]] : ORDER.map((id) => PROVIDERS[id]).filter((p) => p.usable());
  if (!candidates.length || !candidates[0]) throw new LLMError('no-ai', 'Keine KI eingerichtet (Settings → KI)');
  let lastErr;
  for (const p of candidates) {
    try {
      const out = await p.chat({
        messages: msgs, tier, model: model || p.model(tier), maxTokens, temperature, context, signal: sig, onDelta,
      });
      p.reach.up();
      return out;
    } catch (err) {
      if (err?.code !== 'unreachable' || via) throw err;
      p.reach.down(); // eine Weile überspringen, nächsten Anbieter versuchen
      lastErr = err;
    }
  }
  throw lastErr;
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
