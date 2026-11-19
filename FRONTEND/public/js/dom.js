// Construction DOM sûre : jamais d'innerHTML, les données passent par textContent.
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

// États d'automate / de mesure -> libellé + classe CSS de pastille.
export const STATES = {
  ok: { label: 'OK', cls: 'ok' },
  invalid: { label: 'Mesure invalide', cls: 'warn' },
  offline: { label: 'Automate hors ligne', cls: 'ko' },
  pending: { label: 'En attente', cls: 'unknown' },
  disabled: { label: 'Désactivé', cls: 'unknown' },
};

export function badge(stateKey) {
  const s = STATES[stateKey];
  return el('span', { className: `state-badge ${s.cls}` }, [
    el('span', { className: `dot ${s.cls}`, attrs: { 'aria-hidden': 'true' } }),
    el('span', { text: s.label }),
  ]);
}
