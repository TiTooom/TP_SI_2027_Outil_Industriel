// Gestionnaires Modbus du simulateur. Un gestionnaire absent ne produit AUCUNE réponse (le client
// attend jusqu'au timeout) : on les définit tous et on lève un code d'exception Modbus explicite,
// ce qui est le comportement d'un vrai automate.
const UNIT_ID = 1;

const modbusError = (message, modbusErrorCode) => Object.assign(new Error(message), { modbusErrorCode });

function checkUnit(unitID) {
  if (unitID !== UNIT_ID) throw modbusError('Unknown unit', 0x0b);
}

// registers : tableau des registres (l'index est l'adresse), lisibles en holding comme en input.
// writable : adresses de registres que le maître peut écrire (les autres sont en lecture seule).
// coils : tableau de booléens, lisibles et écrivables ; vide = aucun coil. Pas d'entrées discrètes dans ce simulateur.
function createVector(registers, { writable = new Set(), coils = [] } = {}) {
  const readRegister = (addr, unitID) => {
    checkUnit(unitID);
    if (addr >= registers.length) throw modbusError('Illegal address', 0x02);
    return registers[addr];
  };
  const readCoil = (addr, unitID) => {
    checkUnit(unitID);
    if (addr >= coils.length) throw modbusError('Illegal address', 0x02);
    return coils[addr];
  };
  const readDiscrete = (addr, unitID) => {
    checkUnit(unitID);
    throw modbusError('Illegal address', 0x02);
  };
  // Écrire un registre en lecture seule ou inexistant : adresse illégale, comme sur un automate.
  const writeRegister = (addr, value, unitID) => {
    checkUnit(unitID);
    if (!writable.has(addr)) throw modbusError('Illegal address', 0x02);
    registers[addr] = value;
  };
  const writeCoil = (addr, value, unitID) => {
    checkUnit(unitID);
    if (addr >= coils.length) throw modbusError('Illegal address', 0x02);
    coils[addr] = Boolean(value);
  };

  return {
    getHoldingRegister: readRegister,
    getInputRegister: readRegister,
    getCoil: readCoil,
    getDiscreteInput: readDiscrete,
    setRegister: writeRegister,
    setCoil: writeCoil,
  };
}

module.exports = { createVector, UNIT_ID };
