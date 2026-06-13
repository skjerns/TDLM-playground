// Plotly rendering of the two panels:
//   left  — raw probability time series, one trace per state
//   right — TDLM forward/backward/difference sequenceness with permutation
//           significance thresholds (mirrors tdlm/plotting.py::plot_sequenceness)
//
// Plotly is loaded as a global by vendor/plotly.min.js.

const Plotly = globalThis.Plotly;

// Qualitative palette (distinguishable colors), reused for states.
const PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#393b79', '#637939', '#8c6d31', '#843c39', '#7b4173',
];
export const stateColor = (s) => PALETTE[s % PALETTE.length];

const FONT = { family: 'system-ui, sans-serif', size: 13 };

/** Draw the raw probability time series. `onsets` (sample indices) drawn as markers. */
export function drawProbas(divId, probas, times, sfreq, onsets = [], sequence = []) {
  const nStates = probas[0].length;
  const traces = [];
  for (let s = 0; s < nStates; s++) {
    traces.push({
      x: times,
      y: probas.map((row) => row[s]),
      type: 'scatter',
      mode: 'lines',
      name: `state ${s}`,
      line: { color: stateColor(s), width: 1.3 },
      hovertemplate: `state ${s}<br>%{x:.0f} ms<br>%{y:.3f}<extra></extra>`,
    });
  }

  // vertical markers at event onsets (start of each replay sweep)
  const shapes = onsets.map((idx) => ({
    type: 'line',
    x0: (idx / sfreq) * 1000, x1: (idx / sfreq) * 1000,
    y0: 0, y1: 1, yref: 'paper',
    line: { color: 'rgba(0,0,0,0.35)', width: 1, dash: 'dot' },
  }));

  const layout = {
    title: { text: 'Decoded probabilities', font: { ...FONT, size: 15 } },
    xaxis: { title: 'time (ms)', zeroline: false },
    yaxis: { title: 'probability', zeroline: false },
    shapes,
    margin: { l: 55, r: 15, t: 40, b: 45 },
    font: FONT,
    legend: { orientation: 'h', y: -0.18 },
    showlegend: true,
  };
  Plotly.react(divId, traces, layout, { responsive: true, displaylogo: false });
}

// --- sequenceness threshold math (mirrors plot_sequenceness) ----------------

/** mean over permutations (axis 0) of a (nPerms x nLags) matrix, treating NaN as skip. */
function meanOverPerms(mat) {
  const nLags = mat[0].length;
  const out = new Array(nLags).fill(0);
  const cnt = new Array(nLags).fill(0);
  for (let p = 0; p < mat.length; p++)
    for (let l = 0; l < nLags; l++)
      if (!Number.isNaN(mat[p][l])) { out[l] += mat[p][l]; cnt[l]++; }
  for (let l = 0; l < nLags; l++) out[l] = cnt[l] ? out[l] / cnt[l] : NaN;
  return out;
}

/**
 * Permutation thresholds for one direction matrix `sx` (nPerms x (maxLag+1)).
 * perm_maxes = max(|mean(sx[:,1:,1:], 0)|, axis=-1) over shuffles (rows 1..).
 * Returns {threshMax, thresh95}.
 */
function permThresholds(sx) {
  const nPerms = sx.length;
  if (nPerms < 2) return { threshMax: NaN, thresh95: NaN };
  // shuffles only (rows 1..), lags only (cols 1..)
  const permMaxes = [];
  for (let p = 1; p < nPerms; p++) {
    let m = 0;
    for (let l = 1; l < sx[p].length; l++) {
      const v = Math.abs(sx[p][l]);
      if (!Number.isNaN(v) && v > m) m = v;
    }
    permMaxes.push(m);
  }
  const threshMax = Math.max(...permMaxes);
  const sorted = permMaxes.slice().sort((a, b) => a - b);
  const q = (arr, p) => {
    const idx = (arr.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  };
  return { threshMax, thresh95: q(sorted, 0.95) };
}

/**
 * Draw forward/backward/difference sequenceness.
 * @param result {seqFwd, seqBkw} from compute1step (nPerms x (maxLag+1))
 * @param opts {sfreq, minLag, which:[], rescale, showMax, show95}
 */
export function drawSequenceness(divId, result, opts) {
  const { seqFwd, seqBkw } = result;
  const {
    sfreq = 100, minLag = 0,
    which = ['fwd-bkw', 'fwd', 'bkw'],
    rescale = true, showMax = true, show95 = true,
  } = opts;

  const maxLagBins = seqFwd[0].length; // maxLag+1
  // lag axis in ms: column index L corresponds to lag L samples
  const lagsMs = [];
  for (let L = 0; L < maxLagBins; L++) lagsMs.push((L / sfreq) * 1000);

  // difference matrix sf - sb
  const diff = seqFwd.map((row, p) => row.map((v, l) => v - seqBkw[p][l]));
  const directions = {
    'fwd-bkw': { mat: diff, color: '#1f77b4', label: 'fwd − bkw' },
    fwd: { mat: seqFwd, color: '#ff7f0e', label: 'forward' },
    bkw: { mat: seqBkw, color: '#2ca02c', label: 'backward' },
  };

  const traces = [];
  const shapes = [];
  let yMax = 0;

  for (const key of ['fwd-bkw', 'fwd', 'bkw']) {
    if (!which.includes(key)) continue;
    const { mat, color, label } = directions[key];
    const { threshMax, thresh95 } = permThresholds(mat);
    const div = rescale && threshMax > 0 ? threshMax : 1;

    // true curve = row 0, scaled
    const yTrue = mat[0].map((v) => (Number.isNaN(v) ? null : v / div));
    traces.push({
      x: lagsMs, y: yTrue, type: 'scatter', mode: 'lines',
      name: label, line: { color, width: 2 },
      hovertemplate: `${label}<br>lag %{x:.0f} ms<br>%{y:.3f}<extra></extra>`,
    });

    const lineThr = (yVal, dash, alpha) => {
      shapes.push({
        type: 'line', x0: lagsMs[1] ?? 0, x1: lagsMs[lagsMs.length - 1],
        y0: yVal, y1: yVal, line: { color, width: 1.3, dash },
        opacity: alpha,
      });
    };
    if (showMax) {
      const t = rescale ? 1 : threshMax;
      lineThr(t, 'dash', 0.55); lineThr(-t, 'dash', 0.55);
      yMax = Math.max(yMax, Math.abs(t));
    }
    if (show95) {
      const t = thresh95 / div;
      lineThr(t, 'dashdot', 0.4); lineThr(-t, 'dashdot', 0.4);
      yMax = Math.max(yMax, Math.abs(t));
    }
    for (const v of yTrue) if (v !== null) yMax = Math.max(yMax, Math.abs(v));
  }

  // legend-only proxies for the threshold line styles
  if (showMax)
    traces.push({ x: [null], y: [null], mode: 'lines', name: 'perm. max (p<.05)',
      line: { color: '#888', dash: 'dash', width: 1.3 } });
  if (show95)
    traces.push({ x: [null], y: [null], mode: 'lines', name: '95% perm.',
      line: { color: '#888', dash: 'dashdot', width: 1.3 } });

  // always fit the y-range to the data (curves + thresholds) so nothing is clipped
  const pad = yMax > 0 ? yMax * 0.15 : 0.1;
  const yRange = [-(yMax + pad), yMax + pad];
  const layout = {
    title: { text: 'TDLM sequenceness', font: { ...FONT, size: 15 } },
    xaxis: { title: 'lag (ms)', zeroline: false, gridcolor: 'rgba(0,0,0,0.08)' },
    yaxis: { title: rescale ? 'sequenceness (÷ threshold)' : 'sequenceness',
             range: yRange, zeroline: true, zerolinecolor: 'rgba(0,0,0,0.25)' },
    shapes,
    margin: { l: 60, r: 15, t: 40, b: 45 },
    font: FONT,
    legend: { orientation: 'h', y: -0.18 },
  };
  Plotly.react(divId, traces, layout, { responsive: true, displaylogo: false });
}
