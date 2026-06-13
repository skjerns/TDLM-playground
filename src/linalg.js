// Thin wrapper around ml-matrix, plus column-major (Fortran) helpers used to
// mirror NumPy's reshape/ravel(order='F') exactly. The TDLM port depends on
// these matching numpy, so keep them literal.
//
// `mlMatrix` is provided as a global: in the browser by vendor/ml-matrix.umd.js
// (loaded via a plain <script> before the modules), and in Node test harnesses
// by assigning globalThis.mlMatrix before importing this module.

const mlMatrix = (typeof globalThis !== 'undefined' && globalThis.mlMatrix) || null;
if (!mlMatrix) {
  throw new Error('ml-matrix not found on globalThis — load vendor/ml-matrix.umd.js first');
}

export const Matrix = mlMatrix.Matrix;
export const pseudoInverse = mlMatrix.pseudoInverse;

/** Moore-Penrose pseudo-inverse of a 2D array (rows of numbers). Returns 2D array. */
export function pinv(arr2d) {
  return pseudoInverse(new Matrix(arr2d)).to2DArray();
}

/** Matrix product of two 2D arrays. */
export function matmul(a2d, b2d) {
  return new Matrix(a2d).mmul(new Matrix(b2d)).to2DArray();
}

/** Allocate an (rows x cols) 2D array filled with `fill` (default 0). */
export function zeros(rows, cols, fill = 0) {
  const out = new Array(rows);
  for (let i = 0; i < rows; i++) out[i] = new Array(cols).fill(fill);
  return out;
}

/** n x n identity. */
export function eye(n) {
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) out[i][i] = 1;
  return out;
}

/** n x n matrix of ones. */
export function ones(rows, cols) {
  return zeros(rows, cols, 1);
}

/** Transpose a 2D array. */
export function transpose(a2d) {
  const r = a2d.length, c = a2d[0].length;
  const out = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = a2d[i][j];
  return out;
}

/**
 * Column-major (Fortran) flatten of a 2D array, == numpy ravel(order='F').
 * Walks down each column before moving to the next.
 */
export function flattenF(a2d) {
  const r = a2d.length, c = a2d[0].length;
  const out = new Array(r * c);
  let k = 0;
  for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) out[k++] = a2d[i][j];
  return out;
}

/**
 * Reshape a flat array into (rows x cols) column-major, == numpy reshape(order='F').
 * out[i][j] = flat[j*rows + i].
 */
export function reshapeF(flat, rows, cols) {
  const out = zeros(rows, cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < rows; i++) out[i][j] = flat[j * rows + i];
  return out;
}

/** Permute both rows and columns of a square matrix by index array `rp`: out = M[rp][:,rp]. */
export function permuteSquare(M, rp) {
  const n = rp.length;
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i][j] = M[rp[i]][rp[j]];
  return out;
}
