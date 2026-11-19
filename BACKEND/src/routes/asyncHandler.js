// Transmet les rejets de promesses au gestionnaire d'erreurs Express (Express 4 ne le fait pas seul).
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
