const { str, collect, oneOf, isPlainObject } = require('./common');
const { ROLES } = require('../config/roles');
const { passwordPolicyError } = require('../services/passwordHasher');

const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Chaîne vide ou null = pas d'e-mail.
function email(body, { present }) {
  const v = body.email;
  if (v === undefined) return { value: present ? null : undefined };
  if (v === null || v === '') return { value: null };
  if (typeof v !== 'string' || v.length > 255 || !EMAIL_RE.test(v.trim())) return { error: 'email must be a valid e-mail address' };
  return { value: v.trim() };
}

function password(body, field) {
  const problem = passwordPolicyError(body[field], field);
  return problem ? { error: problem } : { value: body[field] };
}

function validateNewUser(body) {
  return collect(body, {
    username: (b) => {
      const r = str(b, 'username', { min: 3, max: 50, required: true });
      if (!r.error && !USERNAME_RE.test(r.value)) return { error: 'username may only contain letters, digits, ".", "_" and "-"' };
      return r;
    },
    email: (b) => email(b, { present: true }),
    password: (b) => password(b, 'password'),
    role: (b) => oneOf(b, 'role', ROLES),
  });
}

// Au moins un champ parmi email / role ; les champs inconnus sont refusés.
function validateUserUpdate(body) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const unknown = Object.keys(body).find((k) => k !== 'email' && k !== 'role');
  if (unknown) return { error: `Unknown field: ${unknown}` };
  if (body.email === undefined && body.role === undefined) return { error: 'email or role is required' };
  const e = email(body, { present: false });
  if (e.error) return e;
  if (body.role !== undefined) {
    const r = oneOf(body, 'role', ROLES);
    if (r.error) return r;
  }
  return { value: { email: e.value, role: body.role } };
}

const validateNewPassword = (body) => collect(body, { new_password: (b) => password(b, 'new_password') });

module.exports = { validateNewUser, validateUserUpdate, validateNewPassword, password };
