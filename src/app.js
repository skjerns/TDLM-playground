// Wires controls -> simulate probas -> run TDLM -> redraw both plots.

import { initControls } from './controls.js';
import { generateProbas } from './sim.js';
import { compute1step, transitionMatrixFromSequence } from './tdlm.js';
import { RNG } from './rng.js';
import { drawProbas, drawSequenceness } from './plots.js';

const sidebar = document.getElementById('controls');
const status = document.getElementById('status');

let pending = false;

function recompute() {
  const t0 = performance.now();
  const { simParams, tdlmParams, displayParams } = controls.getParams();

  // 1) simulate probability time series
  const { probas, times, onsets, sequence } = generateProbas(simParams);

  // 2) run TDLM (separate seeded RNG for the permutation shuffles)
  const tf = transitionMatrixFromSequence(sequence, simParams.nStates);
  const result = compute1step(probas, tf, {
    nShuf: tdlmParams.nShuf,
    maxLag: tdlmParams.maxLag,
    alphaFreq: tdlmParams.alphaFreq,
    rng: new RNG(simParams.seed + 1),
  });

  // 3) draw
  drawProbas('plot-probas', probas, times, simParams.sfreq, onsets, sequence);
  drawSequenceness('plot-seq', result, {
    sfreq: simParams.sfreq,
    which: displayParams.which,
    rescale: displayParams.rescale,
    showMax: displayParams.showMax,
    show95: displayParams.show95,
  });

  const ms = (performance.now() - t0).toFixed(0);
  status.textContent =
    `${simParams.nSamples} samples · ${simParams.nStates} states · ` +
    `${result.perms.length} perms · maxlag ${tdlmParams.maxLag} smp · ${ms} ms`;
}

// run on the next frame so the spinner/status can paint first
function scheduleRecompute() {
  if (pending) return;
  pending = true;
  status.textContent = 'computing…';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        recompute();
      } catch (err) {
        console.error(err);
        status.textContent = 'error: ' + err.message;
      } finally {
        pending = false;
      }
    });
  });
}

const controls = initControls(sidebar, scheduleRecompute);
scheduleRecompute();
