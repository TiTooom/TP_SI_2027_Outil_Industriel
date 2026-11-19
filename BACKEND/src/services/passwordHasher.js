// Hachage scrypt natif (aucune dépendance native sous Alpine). Format : scrypt$N$salt_hex$hash_hex
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, n, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !/^\d+$/.test(n) || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n) });
  return crypto.timingSafeEqual(key, expected);
}

// Hash factice : un login sur un compte inconnu coûte le même temps qu'un mot de passe faux.
const dummyHash = hashPassword('dummy-password-for-constant-time');
async function verifyDummy(password) {
  await verifyPassword(password, await dummyHash);
  return false;
}

// Renvoie un message d'erreur ou null si le mot de passe respecte la politique.
function passwordPolicyError(password, field = 'password') {
  if (typeof password !== 'string') return `${field} must be a string`;
  if (password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
    return `${field} must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters`;
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, verifyDummy, passwordPolicyError, MIN_LENGTH, MAX_LENGTH };
