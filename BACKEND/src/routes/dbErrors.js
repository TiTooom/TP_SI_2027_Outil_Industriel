// Erreurs MariaDB que les routes traduisent en 409.
const isDuplicate = (err) => Boolean(err) && err.code === 'ER_DUP_ENTRY';
const isReferenced = (err) => Boolean(err) && (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED');

module.exports = { isDuplicate, isReferenced };
