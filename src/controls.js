// Builds the control sidebar. Every time-based parameter is entered in
// intuitive units (ms / Hz) and converted to samples for the simulation/TDLM.
// Per-state-capable parameters expose a "per state" toggle that reveals a row
// of n_states inputs; blank entries fall back to the global value.

const $ = (tag, props = {}, children = []) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of [].concat(children)) el.append(c);
  return el;
};

// Declarative schema. `perState` marks params with per-state overrides.
// `unit` 'ms' or 'hz' triggers conversion to samples on read.
const GROUPS = [
  {
    title: 'States & signal',
    items: [
      { key: 'nStates', label: 'number of states', type: 'int', def: 5, min: 2, max: 12, step: 1, rebuild: true, noslider: true },
      { key: 'sfreq', label: 'sampling rate', type: 'num', def: 100, min: 10, max: 1000, step: 10, suffix: 'Hz', retime: true, noslider: true },
      { key: 'duration', label: 'duration', type: 'num', def: 15, min: 2, max: 60, step: 1, suffix: 's', noslider: true },
      { key: 'noise', label: 'noise level (σ)', type: 'num', def: 0.15, min: 0, max: 2, step: 0.01, perState: true },
      { key: 'baseline', label: 'baseline offset', type: 'num', def: 0, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Reactivation',
    items: [
      { key: 'sequence', label: 'sequence order', type: 'text', def: '0,1,2,3,4' },
      { key: 'lag', label: 'lag between states', type: 'num', def: 70, min: 10, max: 500, step: 5, unit: 'ms' },
      { key: 'magnitudeModifier', label: 'magnitude (global ×)', type: 'num', def: 1, min: 0, max: 5, step: 0.1 },
      { key: 'magnitude', label: 'magnitude (per state)', type: 'num', def: 1, min: 0, max: 5, step: 0.1, perState: true },
      { key: 'breadth', label: 'breadth (σ)', type: 'num', def: 20, min: 2, max: 200, step: 2, unit: 'ms', perState: true },
      { key: 'nEvents', label: 'number of events', type: 'int', def: 3, min: 1, max: 50, step: 1 },
      { key: 'jitter', label: 'step jitter (±)', type: 'num', def: 0, min: 0, max: 100, step: 5, unit: 'ms' },
    ],
  },
  {
    title: 'TDLM',
    items: [
      { key: 'maxLag', label: 'max lag', type: 'num', def: 300, min: 50, max: 1000, step: 10, unit: 'ms' },
      { key: 'nShuf', label: 'permutations', type: 'int', def: 100, min: 2, max: 1000, step: 1, noslider: true },
      { key: 'alphaEnabled', label: 'alpha correction', type: 'check', def: false },
      { key: 'alphaFreq', label: 'alpha frequency', type: 'num', def: 10, min: 1, max: 40, step: 1, suffix: 'Hz', noslider: true },
    ],
  },
  {
    title: 'Display',
    items: [
      { key: 'showFwd', label: 'forward', type: 'check', def: true },
      { key: 'showBkw', label: 'backward', type: 'check', def: true },
      { key: 'showDiff', label: 'difference (fwd − bkw)', type: 'check', def: true },
      { key: 'rescale', label: 'rescale to threshold (±1)', type: 'check', def: true },
      { key: 'showMax', label: 'show perm. max (p<.05)', type: 'check', def: true },
      { key: 'show95', label: 'show 95% perm.', type: 'check', def: true },
      { key: 'clipZero', label: 'clip probabilities ≥ 0', type: 'check', def: true },
      { key: 'clipOne', label: 'clip probabilities ≤ 1', type: 'check', def: true },
      { key: 'normalize', label: 'normalize rows to sum 1', type: 'check', def: false },
    ],
  },
];

export function initControls(container, onChange) {
  const inputs = {};        // key -> main input element
  const perStateWrap = {};  // key -> { container, inputs: [] }
  const msControls = [];    // numeric controls whose unit is 'ms' (sample-grid stepped)
  const oscComponents = []; // dynamic list of oscillation components
  let nStates = 5;

  const fire = () => onChange();
  const debouncedFire = debounce(fire, 150);

  function makeInput(item) {
    const id = `ctl-${item.key}`;

    // --- checkbox ---
    if (item.type === 'check') {
      const row = $('div', { className: 'ctl-row' });
      const input = $('input', { type: 'checkbox', id, checked: item.def });
      input.addEventListener('change', fire);
      inputs[item.key] = input;
      row.append($('label', { className: 'ctl-check', htmlFor: id }, [input, $('span', { textContent: ' ' + item.label })]));
      return row;
    }

    // --- free text (sequence order) ---
    if (item.type === 'text') {
      const row = $('div', { className: 'ctl-row' });
      row.append($('label', { htmlFor: id, className: 'ctl-label', textContent: item.label }));
      const input = $('input', { type: 'text', id, value: item.def });
      input.addEventListener('input', debouncedFire);
      inputs[item.key] = input;
      row.append(input);
      return row;
    }

    // --- numeric -> slider + editable readout (kept in sync) ---
    const holder = $('div', { className: 'ctl-num' });
    const top = $('div', { className: 'ctl-row' });

    const label = $('label', { htmlFor: id, className: 'ctl-label', textContent: item.label });
    if (item.suffix || item.unit) {
      label.append($('span', { className: 'ctl-unit', textContent: ' (' + (item.suffix || item.unit) + ')' }));
    }
    top.append(label);

    const readout = $('input', {
      type: 'number', id, value: item.def,
      className: item.noslider ? 'ctl-readout ctl-readout-wide' : 'ctl-readout',
      min: item.min, max: item.max, step: item.step,
    });
    inputs[item.key] = readout; // getParams reads the readout's value

    const onChangeBoth = () => {
      if (item.rebuild) rebuildPerState();
      if (item.retime) updateTimeSteps();
      debouncedFire();
    };

    const slider = item.noslider ? null : $('input', {
      type: 'range', id: id + '-rng', value: item.def, className: 'ctl-slider',
      min: item.min, max: item.max, step: item.step,
    });
    if (slider) {
      slider.addEventListener('input', () => { readout.value = slider.value; onChangeBoth(); });
      readout.addEventListener('input', () => { slider.value = readout.value; onChangeBoth(); });
      if (item.unit === 'ms') msControls.push({ slider, readout, item });
    } else {
      readout.addEventListener('input', onChangeBoth);
    }

    top.append(readout);

    if (item.perState) {
      const btn = $('button', { type: 'button', className: 'ctl-toggle', textContent: '⋯', title: 'override per state' });
      const psBox = $('div', { className: 'ctl-perstate hidden' });
      perStateWrap[item.key] = { box: psBox, item, inputs: [] };
      btn.addEventListener('click', () => {
        psBox.classList.toggle('hidden');
        btn.classList.toggle('active');
      });
      top.append(btn);
      holder.append(top);
      if (slider) holder.append(slider);
      holder.append(psBox);
      buildPerStateInputs(item.key);
      return holder;
    }

    holder.append(top);
    if (slider) holder.append(slider);
    return holder;
  }

  function buildPerStateInputs(key) {
    const ps = perStateWrap[key];
    if (!ps) return;
    ps.box.innerHTML = '';
    ps.inputs = [];
    const grid = $('div', { className: 'ctl-ps-grid' });
    for (let s = 0; s < nStates; s++) {
      const cell = $('div', { className: 'ctl-ps-cell' });
      const inp = $('input', {
        type: 'number', placeholder: 'global',
        min: ps.item.min, max: ps.item.max, step: ps.item.step,
      });
      inp.addEventListener('input', debouncedFire);
      ps.inputs.push(inp);
      cell.append($('span', { className: 'ctl-ps-idx', textContent: s }), inp);
      grid.append(cell);
    }
    ps.box.append(grid);
  }

  function rebuildPerState() {
    nStates = clampInt(inputs.nStates.value, 2, 12, 5);
    for (const key of Object.keys(perStateWrap)) buildPerStateInputs(key);
    // regenerate the natural ascending sequence order for the new state count
    if (inputs.sequence) {
      inputs.sequence.value = Array.from({ length: nStates }, (_, i) => i).join(',');
    }
    for (const c of oscComponents) c.rebuild(nStates); // per-state osc grids
    updateTimeSteps(); // per-state ms inputs need the sample-grid step too
  }

  // Make ms-unit controls step on the sample grid: one sample = 1000/sfreq ms.
  // A 5 ms step is meaningless at 100 Hz (10 ms/sample), so step = sample period
  // (and the minimum becomes one sample). Snaps current values to the grid.
  function updateTimeSteps() {
    const sfreq = Number(inputs.sfreq && inputs.sfreq.value) || 100;
    const period = 1000 / sfreq; // ms per sample
    const snap = (v) => Math.round(Number(v) / period) * period;
    const tidy = (v) => Number(v.toFixed(4)); // avoid float dust like 33.33333

    for (const { slider, readout, item } of msControls) {
      slider.step = readout.step = tidy(period);
      // raise the minimum to one sample, but keep an explicit 0 floor (e.g. jitter)
      if (item.min > 0) slider.min = readout.min = tidy(Math.max(period, Math.ceil(item.min / period) * period));
      const snapped = tidy(Math.max(Number(slider.min) || 0, snap(readout.value)));
      slider.value = readout.value = snapped;
    }
    for (const key of Object.keys(perStateWrap)) {
      const ps = perStateWrap[key];
      if (ps.item.unit === 'ms') ps.inputs.forEach((inp) => { inp.step = tidy(period); });
    }
  }

  // --- dynamic oscillation components ---------------------------------------
  // Each component is an additive sinusoid with its own frequency/amplitude/phase,
  // any of which can be overridden per state. Several can be stacked.
  let oscSeq = 0;
  let oscContainer = null;

  function makeOscField(label, def, min, max, step, unit, useSlider) {
    const holder = $('div', { className: 'ctl-num' });
    const top = $('div', { className: 'ctl-row' });
    const lab = $('label', { className: 'ctl-label', textContent: label });
    if (unit) lab.append($('span', { className: 'ctl-unit', textContent: ' (' + unit + ')' }));
    top.append(lab);

    const readout = $('input', {
      type: 'number', value: def, min, max, step,
      className: useSlider ? 'ctl-readout' : 'ctl-readout ctl-readout-wide',
    });
    const slider = useSlider
      ? $('input', { type: 'range', value: def, min, max, step, className: 'ctl-slider' })
      : null;
    if (slider) {
      slider.addEventListener('input', () => { readout.value = slider.value; debouncedFire(); });
      readout.addEventListener('input', () => { slider.value = readout.value; debouncedFire(); });
    } else {
      readout.addEventListener('input', debouncedFire);
    }

    const psBox = $('div', { className: 'ctl-perstate hidden' });
    const btn = $('button', { type: 'button', className: 'ctl-toggle', textContent: '⋯', title: 'override per state' });
    btn.addEventListener('click', () => { psBox.classList.toggle('hidden'); btn.classList.toggle('active'); });
    top.append(readout, btn);

    const psInputs = [];
    const rebuild = (ns) => {
      psBox.innerHTML = '';
      psInputs.length = 0;
      const grid = $('div', { className: 'ctl-ps-grid' });
      for (let s = 0; s < ns; s++) {
        const cell = $('div', { className: 'ctl-ps-cell' });
        const inp = $('input', { type: 'number', placeholder: 'global', min, max, step });
        inp.addEventListener('input', debouncedFire);
        psInputs.push(inp);
        cell.append($('span', { className: 'ctl-ps-idx', textContent: s }), inp);
        grid.append(cell);
      }
      psBox.append(grid);
    };

    holder.append(top);
    if (slider) holder.append(slider);
    holder.append(psBox);

    const read = () => ({
      global: Number(readout.value),
      perState: psInputs.map((i) => {
        if (i.value === '' || i.value == null) return null;
        const n = Number(i.value);
        return Number.isNaN(n) ? null : n;
      }),
    });
    return { holder, rebuild, read };
  }

  function makeOscComponent() {
    const wrap = $('div', { className: 'osc-comp' });
    const head = $('div', { className: 'osc-comp-head' });
    const rm = $('button', { type: 'button', className: 'osc-remove', textContent: '✕', title: 'remove oscillation' });
    head.append($('span', { className: 'osc-comp-title', textContent: `oscillation #${++oscSeq}` }), rm);
    wrap.append(head);

    const freq = makeOscField('frequency', 10, 1, 40, 1, 'Hz', false);
    const amp = makeOscField('amplitude', 0.1, 0, 2, 0.05, '', true);
    const phase = makeOscField('phase', 0, 0, 6.28, 0.1, 'rad', true);
    wrap.append(freq.holder, amp.holder, phase.holder);

    const comp = {
      el: wrap,
      rebuild: (ns) => { freq.rebuild(ns); amp.rebuild(ns); phase.rebuild(ns); },
      read: () => ({ freq: freq.read(), amp: amp.read(), phase: phase.read() }),
    };
    rm.addEventListener('click', () => {
      const i = oscComponents.indexOf(comp);
      if (i >= 0) oscComponents.splice(i, 1);
      wrap.remove();
      fire();
    });
    return comp;
  }

  function addOscillation() {
    const comp = makeOscComponent();
    comp.rebuild(nStates);
    oscComponents.push(comp);
    oscContainer.append(comp.el);
    fire();
  }

  function buildOscSection() {
    const section = $('section', { className: 'ctl-group' });
    const header = $('h3', { className: 'ctl-group-title', textContent: 'Oscillations' });
    header.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.append(header);
    const body = $('div', { className: 'ctl-group-body' });
    oscContainer = $('div', { className: 'osc-list' });
    const addBtn = $('button', { type: 'button', className: 'ctl-action', textContent: '+ add oscillation' });
    addBtn.addEventListener('click', addOscillation);
    body.append(oscContainer, addBtn);
    section.append(body);
    return section;
  }

  // build DOM
  for (const group of GROUPS) {
    const section = $('section', { className: 'ctl-group' });
    const header = $('h3', { className: 'ctl-group-title', textContent: group.title });
    header.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.append(header);
    const body = $('div', { className: 'ctl-group-body' });
    for (const item of group.items) body.append(makeInput(item));
    section.append(body);
    container.append(section);
    // insert the dynamic Oscillations panel right after Reactivation
    if (group.title === 'Reactivation') container.append(buildOscSection());
  }

  // seed + action row
  const actions = $('section', { className: 'ctl-group' });
  actions.append($('h3', { className: 'ctl-group-title', textContent: 'Seed & actions' }));
  const abody = $('div', { className: 'ctl-group-body' });
  const seedRow = $('div', { className: 'ctl-row' });
  seedRow.append($('label', { className: 'ctl-label', htmlFor: 'ctl-seed', textContent: 'random seed' }));
  const seedInput = $('input', { type: 'number', id: 'ctl-seed', value: 42, min: 0, step: 1 });
  seedInput.addEventListener('input', debouncedFire);
  inputs.seed = seedInput;
  seedRow.append(seedInput);
  const randBtn = $('button', { type: 'button', className: 'ctl-action', textContent: '🎲 randomize seed' });
  randBtn.addEventListener('click', () => { seedInput.value = Math.floor(Math.random() * 1e6); fire(); });
  const resetBtn = $('button', { type: 'button', className: 'ctl-action', textContent: '↺ reset defaults' });
  resetBtn.addEventListener('click', () => { resetDefaults(); rebuildPerState(); fire(); });
  abody.append(seedRow, $('div', { className: 'ctl-row ctl-btns' }, [randBtn, resetBtn]));
  actions.append(abody);
  container.append(actions);

  function resetDefaults() {
    for (const g of GROUPS) for (const it of g.items) {
      if (it.type === 'check') inputs[it.key].checked = it.def;
      else inputs[it.key].value = it.def;
    }
    seedInput.value = 42;
    for (const key of Object.keys(perStateWrap))
      perStateWrap[key].inputs.forEach((i) => (i.value = ''));
    // clear all oscillation components
    oscComponents.splice(0).forEach((c) => c.el.remove());
    oscSeq = 0;
  }

  // --- read widgets into structured params ---
  function val(key) { return inputs[key].value; }
  function num(key) { return Number(inputs[key].value); }
  function checked(key) { return inputs[key].checked; }
  const msToSamp = (ms, sfreq) => Math.max(1, Math.round((Number(ms) / 1000) * sfreq));

  function perStateArr(key, sfreq, isMs) {
    const ps = perStateWrap[key];
    if (!ps) return null;
    return ps.inputs.map((inp) => {
      if (inp.value === '' || inp.value == null) return null; // blank => use global
      const n = isMs ? msToSamp(inp.value, sfreq) : Number(inp.value);
      return Number.isNaN(n) ? null : n;
    });
  }

  function getParams() {
    const sfreq = num('sfreq');
    const ns = clampInt(val('nStates'), 2, 12, 5);
    const nSamples = Math.round(num('duration') * sfreq);

    let sequence = String(val('sequence'))
      .split(/[\s,]+/).filter((x) => x !== '').map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x) && x >= 0 && x < ns);
    if (sequence.length < 2) sequence = Array.from({ length: ns }, (_, i) => i);

    const simParams = {
      nStates: ns, nSamples, sfreq,
      baseline: num('baseline'),
      noise: { global: num('noise'), perState: perStateArr('noise', sfreq, false) },
      magnitude: { global: num('magnitude'), perState: perStateArr('magnitude', sfreq, false) },
      magnitudeModifier: num('magnitudeModifier'),
      breadth: { global: msToSamp(val('breadth'), sfreq), perState: perStateArr('breadth', sfreq, true) },
      lag: msToSamp(val('lag'), sfreq),
      sequence,
      nEvents: clampInt(val('nEvents'), 1, 50, 1),
      jitter: Math.round((num('jitter') / 1000) * sfreq), // ms -> samples (0 -> 0)
      oscillations: oscComponents.map((c) => c.read()),
      clipZero: checked('clipZero'),
      clipOne: checked('clipOne'),
      normalize: checked('normalize'),
      seed: clampInt(seedInput.value, 0, 1e9, 0),
    };

    const tdlmParams = {
      maxLag: msToSamp(val('maxLag'), sfreq),
      nShuf: clampInt(val('nShuf'), 2, 1000, 100),
      alphaFreq: checked('alphaEnabled') ? Math.max(1, Math.round(sfreq / num('alphaFreq'))) : null,
    };

    const which = [];
    if (checked('showDiff')) which.push('fwd-bkw');
    if (checked('showFwd')) which.push('fwd');
    if (checked('showBkw')) which.push('bkw');

    const displayParams = {
      sfreq, which,
      rescale: checked('rescale'), showMax: checked('showMax'), show95: checked('show95'),
    };

    return { simParams, tdlmParams, displayParams };
  }

  rebuildPerState();
  return { getParams };
}

// --- small utilities ---
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
