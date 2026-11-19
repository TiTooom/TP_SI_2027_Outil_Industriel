// Lecture et écriture du cookie de session, sans dépendance supplémentaire.
const COOKIE_NAME = 'sid';

function readCookie(req, name = COOKIE_NAME) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// Pas de `Secure` : le LAN est en HTTP. HttpOnly + SameSite=Strict protègent le jeton.
function setSessionCookie(res, token, maxAgeS) {
  res.append('Set-Cookie', `${COOKIE_NAME}=${token}; Max-Age=${maxAgeS}; Path=/; HttpOnly; SameSite=Strict`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`);
}

module.exports = { readCookie, setSessionCookie, clearSessionCookie, COOKIE_NAME };
