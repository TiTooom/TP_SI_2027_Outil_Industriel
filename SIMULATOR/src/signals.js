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

// Valeurs que l'application peut écrire : registres holding jamais recalculés, et sorties TOR (coils).
// Elles servent à démontrer l'écriture vers l'automate : la valeur écrite est relue telle quelle.
const SETPOINTS = [
  { address: 10, initial: 250 }, // consigne de température (x0.1 °C) : 25,0 °C
  { address: 11, initial: 200 }, // consigne de pression (x0.01 bar) : 2,00 bar
];
const COIL_COUNT = 4; // coil 0 : marche pompe ; tous à 0 (arrêt) au démarrage
const REGISTER_COUNT = 16; // adresses 0 à 15 ; celles qui ne servent à rien lisent 0, comme un vrai automate

module.exports = { SIGNALS, SETPOINTS, COIL_COUNT, REGISTER_COUNT, rawValue };
