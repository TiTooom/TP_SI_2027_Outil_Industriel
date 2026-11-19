// Gestionnaires Modbus du simulateur. Un gestionnaire absent ne produit AUCUNE réponse (le client
// attend jusqu'au timeout) : on les définit tous et on lève un code d'exception Modbus explicite,
// ce qui est le comportement d'un vrai automate.
const UNIT_ID = 1;

const modbusError = (message, modbusErrorCode) => Object.assign(new Error(message), { modbusErrorCode });

function checkUnit(unitID) {
  if (unitID !== UNIT_ID) throw modbusError('Unknown unit', 0x0b);
}

function createVector(registers) {
  const readRegister = (addr, unitID) => {
    checkUnit(unitID);
    if (addr >= registers.length) throw modbusError('Illegal address', 0x02);
    return registers[addr];
  };
  // Pas de bits dans ce simulateur : toute lecture de bit est une adresse illégale.
  const readBit = (addr, unitID) => {
    checkUnit(unitID);
    throw modbusError('Illegal address', 0x02);
  };
  // Lecture seule : fonction d'écriture refusée (exception 0x01 « illegal function »).
  const refuseWrite = () => { throw modbusError('Write not supported', 0x01); };

  return {
    getHoldingRegister: readRegister,
    getInputRegister: readRegister,
    getCoil: readBit,
    getDiscreteInput: readBit,
    setRegister: refuseWrite,
    setCoil: refuseWrite,
  };
}

module.exports = { createVector, UNIT_ID };
