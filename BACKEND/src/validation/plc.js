const { str, int, bool, collect } = require('./common');

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOST_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function isValidHost(host) {
  if (host.length > 255) return false;
  const ipv4 = IPV4.exec(host);
  if (ipv4) return ipv4.slice(1).every((n) => Number(n) <= 255);
  // Une suite de chiffres et de points qui n'est pas une IPv4 valide n'est pas un nom DNS.
  if (/^[\d.]+$/.test(host)) return false;
  return host.split('.').every((label) => HOST_LABEL.test(label));
}

// Cibles refusées : l'API servirait de relais pour sonder le conteneur lui-même ou ses services
// internes (SSRF). Le simulateur reste autorisé.
const INTERNAL_NAMES = new Set(['localhost', 'db', 'backend', 'frontend']);

function isForbiddenHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === '::1' || INTERNAL_NAMES.has(h) || h.endsWith('.localhost')) return true;
  const ipv4 = IPV4.exec(h);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 127 || a === 0 || (a === 169 && b === 254);
}

function validatePlc(body) {
  const result = collect(body, {
    name: (b) => str(b, 'name', { min: 1, max: 100, required: true }),
    host: (b) => str(b, 'host', { min: 1, max: 255, required: true }),
    port: (b) => int(b, 'port', { min: 1, max: 65535, fallback: 502 }),
    unit_id: (b) => int(b, 'unit_id', { min: 0, max: 255, fallback: 1 }),
    enabled: (b) => bool(b, 'enabled', true),
  });
  if (result.error) return result;
  const { host } = result.value;
  if (isForbiddenHost(host)) return { error: 'host is not allowed' };
  if (!isValidHost(host)) return { error: 'host must be an IPv4 address or a valid DNS name' };
  return result;
}

module.exports = { validatePlc, isValidHost, isForbiddenHost };
