// Ähnliche Fragen (Test): Embeddings der Fragen (Dateinamen) über einen lokalen Ollama-Server am Computer berechnen,
// in .picker/embeddings.json im Vault ablegen (synct mit, das Handy kann damit vergleichen) und die ähnlichsten
// Fragenpaare finden. Nur die Logik; die Oberfläche steht in Settings (sync.js).
import { isConfig } from './srs.js';
import { isStreamsConfig } from './streamsdoc.js';
import { PROMPTS_PATH } from './prompts.js';

export const FILE = 'embeddings.json';
export const DEFAULT_URL = 'http://localhost:11434';
export const DEFAULT_MODEL = 'qwen3-embedding:0.6b';
const BATCH = 32;
const URL_KEY = 'embed-url';
const MODEL_KEY = 'embed-model';

const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const set = (k, v, d) => { try { if (v && v !== d) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* egal */ } };
export const embedUrl = () => get(URL_KEY, DEFAULT_URL);
export const embedModel = () => get(MODEL_KEY, DEFAULT_MODEL);
export const setEmbedUrl = (v) => set(URL_KEY, v.trim().replace(/\/+$/, ''), DEFAULT_URL);
export const setEmbedModel = (v) => set(MODEL_KEY, v.trim(), DEFAULT_MODEL);

/**
 * Text, der eingebettet wird. Qwen3-Embeddings arbeiten mit einer Anweisung, e5-Modelle mit „query: “; alle Fragen
 * bekommen dieselbe, damit sie untereinander vergleichbar sind.
 */
export function promptFor(model) {
  if (/qwen3/i.test(model)) return 'Instruct: Given a question, find other questions that ask the same thing\nQuery: ';
  if (/e5/i.test(model)) return 'query: ';
  return '';
}

/**
 * Wie viele Werte pro Vektor gespeichert werden: Qwen3-Embeddings sind darauf trainiert, dass man sie kürzen kann
 * (256 reichen für Fragen und halten die Datei klein), andere Modelle behalten alle (0). Gespeichert wird als int8.
 */
export const dimsFor = (model) => (/qwen3/i.test(model) ? 256 : 0);

/** Notizen, deren Namen verglichen werden (ohne Review.md, Streams.md, Prompts.md). */
export function questionNotes(notes) {
  return notes.filter((n) => !isConfig(n.path) && !isStreamsConfig(n.path) && n.path.toLowerCase() !== PROMPTS_PATH.toLowerCase());
}

/** Ein Aufruf an Ollama (/api/embed) für mehrere Texte → [[Zahl]]. */
export async function embed(url, model, texts) {
  let res;
  try {
    res = await fetch(url + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    });
  } catch (err) {
    throw new Error(`Ollama unter ${url} nicht erreichbar – läuft der Server, ist OLLAMA_ORIGINS gesetzt und der Zugriff aufs lokale Netzwerk erlaubt? (${err.message})`);
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(res.status === 404 && /model/i.test(msg) ? `Modell „${model}“ fehlt – im Terminal: ollama pull ${model}` : `Ollama: ${res.status} ${msg.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) throw new Error('Ollama: unerwartete Antwort');
  return data.embeddings;
}

/** Vektor ggf. auf `dims` kürzen, normieren und als int8 (base64) ablegen. */
export function pack(vec, dims = 0) {
  const v = dims ? vec.slice(0, dims) : vec;
  const norm = Math.hypot(...v) || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round((v[i] / norm) * 127)));
  let s = '';
  for (const b of new Uint8Array(q.buffer)) s += String.fromCharCode(b);
  return btoa(s);
}

export function unpack(b64) {
  const s = atob(b64);
  const q = new Int8Array(s.length);
  for (let i = 0; i < s.length; i++) q[i] = (s.charCodeAt(i) << 24) >> 24;
  return q;
}

/** Gespeicherter Stand: { model, prompt, dims, items: { Pfad: [Titel, Vektor (base64)] } } oder ein leerer. */
export function parseStore(text, model) {
  const empty = { version: 1, model, prompt: promptFor(model), dims: dimsFor(model), items: {} };
  try {
    const s = JSON.parse(text || '');
    // anderes Modell oder andere Anweisung: Vektoren sind nicht vergleichbar, neu berechnen
    return s && s.model === model && s.prompt === promptFor(model) && s.dims === dimsFor(model) && s.items ? s : empty;
  } catch {
    return empty;
  }
}

/**
 * Berechnet fehlende Vektoren (neue oder umbenannte Notizen) und entfernt die gelöschter. `save(store)` wird
 * zwischendurch aufgerufen, damit ein Abbruch nichts verliert. onProgress(fertig, gesamt).
 */
export async function updateStore(store, notes, { url, model, save, onProgress = () => {}, signal }) {
  const qs = questionNotes(notes);
  const keep = new Set(qs.map((n) => n.path));
  for (const p of Object.keys(store.items)) if (!keep.has(p)) delete store.items[p];
  const todo = qs.filter((n) => store.items[n.path]?.[0] !== n.title);
  const prompt = promptFor(model);
  let done = 0;
  onProgress(0, todo.length);
  for (let i = 0; i < todo.length; i += BATCH) {
    if (signal?.aborted) break;
    const batch = todo.slice(i, i + BATCH);
    const vecs = await embed(url, model, batch.map((n) => prompt + n.title + '?'));
    batch.forEach((n, k) => { store.items[n.path] = [n.title, pack(vecs[k], store.dims)]; });
    done += batch.length;
    onProgress(done, todo.length);
    if ((i / BATCH) % 10 === 9) await save(store);
  }
  await save(store);
  return { computed: done, total: qs.length };
}

/**
 * Ähnlichste Paare (Kosinus ≥ min), absteigend, höchstens `limit`. Rechnet in Häppchen, damit die Seite bedienbar
 * bleibt. Gibt [{ a, b (Pfade), score }] zurück.
 */
export async function similarPairs(store, { min = 0.8, limit = 200, onProgress = () => {} } = {}) {
  const paths = Object.keys(store.items);
  const vecs = paths.map((p) => unpack(store.items[p][1]));
  const scale = 127 * 127;
  const out = [];
  for (let i = 0; i < vecs.length; i++) {
    const a = vecs[i];
    for (let j = i + 1; j < vecs.length; j++) {
      const b = vecs[j];
      let dot = 0;
      for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
      const score = dot / scale;
      if (score >= min) out.push({ a: paths[i], b: paths[j], score });
    }
    if (i % 200 === 199) { onProgress(i + 1, vecs.length); await new Promise((r) => setTimeout(r)); }
  }
  onProgress(vecs.length, vecs.length);
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
