const { str, collect } = require('./common');

const validateTeam = (body) => collect(body, { name: (b) => str(b, 'name', { min: 1, max: 100, required: true }) });

module.exports = { validateTeam };
