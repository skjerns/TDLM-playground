// Exercises controls.js in Node via a minimal DOM shim. Verifies that the
// control panel builds, getParams() returns a well-formed params object,
// changing n_states regenerates the sequence + per-state grids, and that
// oscillation components can be added/removed.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

class FakeEl {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this._classes = new Set(); this.parent = null;
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c) => { if (this._classes.has(c)) { this._classes.delete(c); return false; } this._classes.add(c); return true; },
      contains: (c) => this._classes.has(c),
    };
  }
  set className(v) { this._cls = v; this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this._cls || ''; }
  set innerHTML(v) { if (v === '') this.children = []; this._html = v; }
  get innerHTML() { return this._html || ''; }
  append(...kids) { for (const k of kids) { if (k == null) continue; if (typeof k !== 'string') k.parent = this; this.children.push(k); } }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t) { (this.listeners[t] || []).forEach((fn) => fn({ target: this })); }
  click() { this.dispatch('click'); }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } }
  find(pred) { if (pred(this)) return this; for (const c of this.children) if (c instanceof FakeEl) { const r = c.find(pred); if (r) return r; } return null; }
}

globalThis.document = { createElement: (tag) => { const e = new FakeEl(tag); if (tag === 'input') e.value = ''; return e; } };

const { initControls } = await import(join(root, 'src/controls.js'));

let changes = 0;
const container = new FakeEl('div');
const controls = initControls(container, () => { changes++; });

let fail = 0;
const expect = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };

// 1) defaults
let p = controls.getParams();
expect(p.simParams.nStates === 5, `default n_states = ${p.simParams.nStates}`);
expect(JSON.stringify(p.simParams.sequence) === '[0,1,2,3,4]', `default sequence = ${JSON.stringify(p.simParams.sequence)}`);
expect(Array.isArray(p.simParams.oscillations) && p.simParams.oscillations.length === 0, 'no oscillations by default');
expect(p.tdlmParams.nShuf === 100, 'tdlm defaults present');
expect(p.simParams.lag === 7, `lag 70ms -> ${p.simParams.lag} samples @100Hz`);

// 2) change n_states -> sequence regenerates, per-state grids resize
const nStatesEl = container.find((e) => e.id === 'ctl-nStates');
nStatesEl.value = '7';
nStatesEl.dispatch('input');
p = controls.getParams();
expect(p.simParams.nStates === 7, `n_states -> ${p.simParams.nStates}`);
expect(JSON.stringify(p.simParams.sequence) === '[0,1,2,3,4,5,6]', `sequence regenerated -> ${JSON.stringify(p.simParams.sequence)}`);
expect(p.simParams.noise.perState.length === 7, `per-state noise grid resized -> ${p.simParams.noise.perState.length}`);

// 3) add two oscillations
const addBtn = container.find((e) => e.children[0] === '+ add oscillation' || (typeof e.textContent === 'string' && false));
// the add button's textContent is set via property; find by tag=button and a click listener creating osc
const addButton = container.find((e) => e.tag === 'button' && e.textContent === '+ add oscillation');
addButton.click();
addButton.click();
p = controls.getParams();
expect(p.simParams.oscillations.length === 2, `added oscillations -> ${p.simParams.oscillations.length}`);
const osc0 = p.simParams.oscillations[0];
expect(osc0.freq.global === 10 && osc0.amp.global === 0.1, 'oscillation defaults (10Hz, amp 0.1)');
expect(osc0.freq.perState.length === 7, `oscillation per-state grid matches n_states -> ${osc0.freq.perState.length}`);

// 4) sampling-rate change retimes the lag step (ms -> sample grid)
const sfreqEl = container.find((e) => e.id === 'ctl-sfreq');
sfreqEl.value = '200';
sfreqEl.dispatch('input');
const lagEl = container.find((e) => e.id === 'ctl-lag');
expect(Number(lagEl.step) === 5, `lag step retimed to 1000/200 = 5ms (got ${lagEl.step})`);

// 5) presets: backward (B) sets a reversed reactivation order != sequence
const presetEl = container.find((e) => e.tag === 'select' && e.id === 'ctl-preset');
presetEl.value = 'B';
presetEl.dispatch('change');
p = controls.getParams();
expect(JSON.stringify(p.simParams.sequence) === '[0,1,2,3,4]', `B: tf sequence forward (${JSON.stringify(p.simParams.sequence)})`);
expect(JSON.stringify(p.simParams.reactivationOrder) === '[4,3,2,1,0]', `B: reactivation order reversed (${JSON.stringify(p.simParams.reactivationOrder)})`);
expect(p.simParams.oscillations.length === 0, 'B: preset cleared oscillations');

// 6) preset D sets per-state magnitude with zeros (missing items)
presetEl.value = 'D';
presetEl.dispatch('change');
p = controls.getParams();
expect(JSON.stringify(p.simParams.magnitude.perState) === '[1,0,1,0,1]', `D: per-state magnitude (${JSON.stringify(p.simParams.magnitude.perState)})`);

// 7) a manual edit reverts the dropdown to custom
const noiseEl = container.find((e) => e.id === 'ctl-noise');
noiseEl.value = '0.3';
noiseEl.dispatch('input');
expect(presetEl.value === '', `manual edit reverts preset to custom (got "${presetEl.value}")`);

console.log('\n' + (fail ? `${fail} CHECK(S) FAILED` : 'DOM TEST PASSED'));
process.exit(fail ? 1 : 0);
