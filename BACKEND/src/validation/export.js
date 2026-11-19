// Validation de GET /api/export.csv?variableIds&from&to[&check=1].
const env = require('../config/env');
const { parseDate } = require('./measures');
const { parseId } = require('./common');

const MAX_IDS = 50;
const DAY_MS = 24 * 3600 * 1000;

function parseIds(raw) {
  if (typeof raw !== 'string' || raw === '') return { error: 'variableIds is required (comma-separated positive integers)' };
  const ids = [];
  for (const part of raw.split(',')) {
    const id = parseId(part);
    if (!id) return { error: 'variableIds must be a comma-separated list of positive integers' };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_IDS) return { error: `variableIds must contain at most ${MAX_IDS} ids` };
  return { value: ids };
}

function validateExportQuery(query) {
  const ids = parseIds(query.variableIds);
  if (ids.error) return ids;
  if (query.from === undefined || query.to === undefined) return { error: 'from and to are required' };
  const from = parseDate(query.from, 'from');
  if (from.error) return from;
  const to = parseDate(query.to, 'to');
  if (to.error) return to;
  if (from.value >= to.value) return { error: 'from must be before to' };
  if (to.value - from.value > env.exportMaxDays * DAY_MS) {
    return { error: `Time range must not exceed ${env.exportMaxDays} days` };
  }
  if (query.check !== undefined && query.check !== '1') return { error: 'check must be 1' };
  return { value: { ids: ids.value, from: from.value, to: to.value, check: query.check === '1' } };
}

module.exports = { validateExportQuery };
