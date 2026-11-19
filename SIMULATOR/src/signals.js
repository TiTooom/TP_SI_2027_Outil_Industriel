// Valeurs brutes simulées : sinusoïde lente + bruit, bornées à la plage du contrat (voir README.md).
const SIGNALS = [
  { address: 0, min: 150, max: 350, periodS: 120 }, // température (x0.1 °C)
  { address: 1, min: 100, max: 400, periodS: 90 }, // pression (x0.01 bar)
  { address: 2, min: 100, max: 900, periodS: 150 }, // débit (x0.1 m3/h)
  { address: 3, min: 200, max: 900, periodS: 200 }, // niveau (x0.1 %)
];

// Entier brut au temps t (secondes) ; noise dans [-1, 1] pour pouvoir figer l'aléa en test.
function rawValue({ min, max, periodS, address }, tSeconds, noise) {
  const mid = (min + max) / 2;
  const amplitude = (max - min) / 2;
  // Déphasage par adresse pour que les courbes ne soient pas synchrones.
  const wave = Math.sin((2 * Math.PI * tSeconds) / periodS + address);
  const value = mid + amplitude * 0.9 * wave + amplitude * 0.05 * noise;
  return Math.round(Math.min(max, Math.max(min, value)));
}

module.exports = { SIGNALS, rawValue };
