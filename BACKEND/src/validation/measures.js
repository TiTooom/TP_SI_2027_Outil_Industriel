// Validation de ?from&to&limit pour GET /api/variables/:id/measures.
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const MAX_RANGE_MS = 7 * 24 * 3600 * 1000;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

// Fuseau obligatoire (Z ou +hh:mm) : une date sans fuseau serait ambiguë.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseDate(raw, field) {
  if (typeof raw !== 'string' || !ISO_WITH_ZONE.test(raw)) {
    return { error: `${field} must be an ISO 8601 date with timezone (e.g. 2026-11-19T10:00:00Z)` };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { error: `${field} is not a valid date` };
  // Date.parse déborde silencieusement (31 février -> 3 mars) : on compare le jour saisi à celui obtenu.
  const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return { error: `${field} is not a valid date` };
  }
  return { value: date };
}

function parseLimit(raw) {
  if (raw === undefined) return { value: DEFAULT_LIMIT };
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_LIMIT) {
    return { error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  }
  return { value: Number(raw) };
}

// `now` injectable pour des tests déterministes.
function validateMeasuresQuery(query, now = new Date()) {
  let to = now;
  if (query.to !== undefined) {
    const r = parseDate(query.to, 'to');
    if (r.error) return r;
    to = r.value;
  }
  let from = new Date(to.getTime() - DEFAULT_WINDOW_MS);
  if (query.from !== undefined) {
    const r = parseDate(query.from, 'from');
    if (r.error) return r;
    from = r.value;
  }
  if (from >= to) return { error: 'from must be before to' };
  if (to - from > MAX_RANGE_MS) return { error: 'Time range must not exceed 7 days' };
  const limit = parseLimit(query.limit);
  if (limit.error) return limit;
  return { value: { from, to, limit: limit.value } };
}

module.exports = { validateMeasuresQuery, DEFAULT_LIMIT, MAX_LIMIT };
