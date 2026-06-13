// Full integration test: runs app.js end-to-end with a DOM + Plotly stub.
// Confirms the app wires controls -> sim -> TDLM -> sign-flip -> 3 plot calls
// with well-formed trace data, exactly as it would in the browser.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
globalThis.mlMatrix = require(join(here, 'ml-matrix.cjs'));

class FakeEl {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this._classes = new Set(); this.parent = null;
    this.classList = {
      add: (c) => this._classes.add(c), remove: (c) => this._classes.delete(c),
      toggle: (c) => { if (this._classes.has(c)) { this._classes.delete(c); return false; } this._classes.add(c); return true; },
      contains: (c) => this._classes.has(c),
    };
  }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  set innerHTML(v) { if (v === '') this.children = []; }
  append(...kids) { for (const k of kids) { if (k == null) continue; if (typeof k !== 'string') k.parent = this; this.children.push(k); } }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } }
}

const byId = {};
for (const id of ['controls', 'status', 'plot-probas', 'plot-seq']) byId[id] = new FakeEl(id);
globalThis.document = { createElement: (t) => { const e = new FakeEl(t); if (t === 'input') e.value = ''; return e; }, getElementById: (id) => byId[id] };
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
globalThis.performance = { now: () => 0 };

const plotCalls = {};
globalThis.Plotly = { react: (id, traces, layout) => { plotCalls[id] = { traces, layout }; } };

await import(join(root, 'src/app.js')); // side effect: builds UI + runs first recompute

let fail = 0;
const expect = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };

expect(!!plotCalls['plot-probas'], 'probas plot drawn');
expect(!!plotCalls['plot-seq'], 'sequenceness plot drawn');

const probaTraces = plotCalls['plot-probas'].traces;
expect(probaTraces.length === 5, `probas has 5 state traces (got ${probaTraces.length})`);
expect(probaTraces[0].y.length === 1000, `probas trace length = ${probaTraces[0].y.length}`);

const seqTraces = plotCalls['plot-seq'].traces;
const named = seqTraces.filter((t) => t.y && t.y.length > 2).map((t) => t.name);
expect(named.includes('forward') && named.includes('backward') && named.includes('fwd − bkw'),
  `sequenceness has fwd/bkw/diff curves (got ${named.join(', ')})`);

const statusText = byId['status'].textContent || '';
expect(/maxlag/.test(statusText), `status line: "${statusText}"`);

console.log('\n' + (fail ? `${fail} CHECK(S) FAILED` : 'APP INTEGRATION TEST PASSED'));
process.exit(fail ? 1 : 0);
