// Synthesize probability time series (`probas`, shape n_samples x n_states) that
// emulate classifier output during replay: baseline + per-state Gaussian noise,
// time-lagged reactivation "bumps" along a sequence, and optional oscillations.
//
// This is the input to TDLM. We synthesize probas directly (rather than
// simulating M/EEG channels + a classifier) because TDLM operates on probas.

import { RNG } from './rng.js';
import { zeros } from './linalg.js';

/**
 * Resolve a parameter that may be global or per-state into a length-n_states array.
 * `perState` entries that are null/undefined/'' fall back to the global value.
 */
function resolvePerState(globalVal, perState, nStates) {
  const out = new Array(nStates);
  for (let s = 0; s < nStates; s++) {
    const v = perState && perState[s];
    out[s] = (v === null || v === undefined || v === '') ? globalVal : Number(v);
  }
  return out;
}

/**
 * Generate probas plus metadata.
 *
 * params:
 *   nStates, nSamples, sfreq
 *   baseline                      constant added to every state (default 0)
 *   noise        {global, perState[]}   stdev of Gaussian noise
 *   magnitude    {global, perState[]}   reactivation bump height (global is a modifier)
 *   breadth      {global, perState[]}   reactivation bump width (Gaussian sigma, samples)
 *   lag                            samples between consecutive states in the sequence
 *   sequence                       array of state indices, e.g. [0,1,2,3,4]
 *   nEvents                        number of replay events (sweeps through the sequence)
 *   jitter                         +/- samples of random jitter per step (0 = off)
 *   oscillations  array of additive sinusoidal components, each
 *                 {freq:{global,perState[]}, phase:{...}, amp:{...}}
 *   clipZero                       clamp probas at >= 0 (default true)
 *   clipOne                        clamp probas at <= 1 so the max probability is 1 (default true)
 *   normalize                      row-normalize so each timestep sums to 1 (default false)
 *   seed
 *
 * @returns {{probas:number[][], times:number[], onsets:number[], sequence:number[]}}
 *   times in milliseconds.
 */
export function generateProbas(params) {
  const {
    nStates, nSamples, sfreq,
    baseline = 0,
    noise, magnitude, breadth,
    lag, sequence, nEvents,
    jitter = 0,
    oscillations = [],
    clipZero = true, clipOne = true, normalize = false,
    seed = 0,
  } = params;

  const rng = new RNG(seed);

  const noiseArr = resolvePerState(noise.global, noise.perState, nStates);
  const magArr = resolvePerState(magnitude.global, magnitude.perState, nStates);
  const breadthArr = resolvePerState(breadth.global, breadth.perState, nStates);

  // --- baseline + noise ---
  const probas = zeros(nSamples, nStates);
  for (let i = 0; i < nSamples; i++) {
    for (let s = 0; s < nStates; s++) {
      probas[i][s] = baseline + rng.gaussian(0, noiseArr[s]);
    }
  }

  // --- place event onsets deterministically (always the same positions) ---
  // Events are spread evenly across the usable span so that changing unrelated
  // parameters (noise, magnitude, ...) never moves the replay. A single event is
  // centred; trains are equally spaced with the refractory gap respected.
  const seq = sequence.slice();
  const eventSpan = (seq.length - 1) * lag; // samples from first to last bump center
  const margin = Math.ceil(3 * Math.max(...breadthArr)); // keep bumps inside bounds
  const lo = margin;
  const hi = nSamples - eventSpan - margin;
  const onsets = [];
  if (hi > lo) {
    if (nEvents === 1) {
      onsets.push(Math.round((lo + hi) / 2));
    } else {
      // evenly spaced centres of nEvents slots across [lo, hi]
      const span = hi - lo;
      for (let i = 0; i < nEvents; i++) {
        onsets.push(Math.round(lo + (span * (i + 0.5)) / nEvents));
      }
    }
  }

  // --- inject reactivation bumps along the sequence ---
  // magArr[s] is the per-state bump height (falling back to magnitude.global);
  // magnitudeModifier is the global multiplier applied on top of all of them.
  const modifier = params.magnitudeModifier ?? 1;
  for (const onset of onsets) {
    let pos = onset;
    for (let step = 0; step < seq.length; step++) {
      const s = seq[step];
      const sigma = breadthArr[s];
      const height = magArr[s] * modifier;
      const c = pos;
      const halfWin = Math.ceil(4 * sigma);
      for (let t = Math.max(0, c - halfWin); t < Math.min(nSamples, c + halfWin); t++) {
        probas[t][s] += height * Math.exp(-0.5 * ((t - c) / sigma) ** 2);
      }
      const stepJitter = jitter ? (rng.int(2 * jitter + 1) - jitter) : 0;
      pos += lag + stepJitter;
    }
  }

  // --- oscillations (sum of any number of additive sinusoidal components) ---
  for (const comp of oscillations) {
    const freqArr = resolvePerState(comp.freq.global, comp.freq.perState, nStates);
    const phaseArr = resolvePerState(comp.phase.global, comp.phase.perState, nStates);
    const ampArr = resolvePerState(comp.amp.global, comp.amp.perState, nStates);
    for (let i = 0; i < nSamples; i++) {
      const tSec = i / sfreq;
      for (let s = 0; s < nStates; s++) {
        probas[i][s] += ampArr[s] * Math.sin(2 * Math.PI * freqArr[s] * tSec + phaseArr[s]);
      }
    }
  }

  // --- post-processing ---
  if (clipZero) {
    for (let i = 0; i < nSamples; i++)
      for (let s = 0; s < nStates; s++)
        if (probas[i][s] < 0) probas[i][s] = 0;
  }
  if (clipOne) {
    for (let i = 0; i < nSamples; i++)
      for (let s = 0; s < nStates; s++)
        if (probas[i][s] > 1) probas[i][s] = 1;
  }
  if (normalize) {
    for (let i = 0; i < nSamples; i++) {
      let sum = 0;
      for (let s = 0; s < nStates; s++) sum += probas[i][s];
      if (sum > 0) for (let s = 0; s < nStates; s++) probas[i][s] /= sum;
    }
  }

  const times = new Array(nSamples);
  for (let i = 0; i < nSamples; i++) times[i] = (i / sfreq) * 1000;

  return { probas, times, onsets, sequence: seq };
}
