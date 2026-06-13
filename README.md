# TDLM Replay Playground

An interactive, browser-only applet to **simulate** simple neural replay and
**evaluate** it with [Temporally Delayed Linear Modelling (TDLM)](https://elifesciences.org/articles/66917).
It is a teaching/intuition tool for the [TDLM-Python](https://github.com/skjerns/TDLM-Python)
package: you synthesise decoded-probability time series with reactivation events,
noise and oscillations, and watch the forward/backward/difference sequenceness
respond in real time.

Everything runs client-side — no server, no build step. Just static files.

## Panels

- **Decoded probabilities** (left): one trace per state. A replay *event* is a
  train of Gaussian reactivation bumps along the sequence, each lagged from the
  previous state. Dotted lines mark event onsets (deterministically placed so
  unrelated parameters never move them).
- **TDLM sequenceness** (right): forward / backward / difference sequenceness
  vs. time lag, with permutation-max (p<.05) and 95% thresholds. Rescaling puts
  the perm-max threshold at ±1.

## Parameters

Most parameters can be set **globally or per state** (the `⋯` button reveals a
per-state override row; blank = use the global value):

- States & signal: number of states, sampling rate, duration, **noise**, baseline
- Reactivation: sequence order, lag between states, **magnitude** (global × and
  per state), **breadth**, number of events, step jitter
- **Oscillations**: add any number of additive sinusoids, each with its own
  frequency / amplitude / phase, global or per state
- TDLM: max lag, permutations, **alpha correction** (frequency)
- Display: which curves to show, rescale, thresholds, clip/normalise; plus a
  reproducible random **seed**

Time-based parameters are entered in ms but snap to the sample grid (their step
size follows the sampling rate). The sequence order regenerates automatically
when you change the number of states.

## Run locally

```bash
python3 -m http.server 8000   # or: npm run serve
# open http://localhost:8000
```

No dependencies to install — `ml-matrix` and `plotly` are vendored in `vendor/`.

## Deploy to GitHub Pages

Push to GitHub and either:

- enable **Settings → Pages → Deploy from branch** (root of `main`), or
- use the included workflow `.github/workflows/pages.yml` (Pages source = GitHub
  Actions), which publishes the repo root on every push to `main`.

## Numerical correctness

The TDLM port in `src/tdlm.js` is verified against the Python `tdlm` package to
machine precision. The tests need a one-off standalone Node and the Python package:

```bash
python3 tools/gen_reference.py          # dump reference outputs from tdlm (Python)
cp vendor/ml-matrix.umd.js tools/ml-matrix.cjs   # CJS copy for Node require()
node tools/parity_test.mjs              # JS vs Python: findBetas, sequenceness, sign-flip t_obs
node tools/smoke_test.mjs               # sim -> TDLM -> sign-flip behaviour
node tools/dom_test.mjs                 # controls.js logic (DOM shim)
node tools/app_test.mjs                 # full app pipeline (DOM + Plotly stub)
```

`parity_test.mjs` asserts `findBetas`, true-row forward/backward sequenceness
(with and without alpha correction), and the sign-flip observed t all match the
Python implementation to < 1e-9.

## Layout

```
index.html          page + vendored library <script> tags
styles.css
src/
  app.js            wiring: controls -> sim -> TDLM -> sign-flip -> plots
  controls.js       parameter sidebar (global + per-state, sliders, oscillations)
  sim.js            generateProbas(): synthesise probability time series
  tdlm.js           compute1step + findBetas + uniquePermutations + signflipTest
  linalg.js         ml-matrix wrapper + Fortran-order reshape/squash helpers
  rng.js            seedable PRNG + gaussian/shuffle
  plots.js          Plotly rendering of the three panels
vendor/             ml-matrix.umd.js, plotly.min.js
tools/              reference generator + Node test suites
```
