// Générateur CSV maison : export-to-csv construit le CSV entier en mémoire (generateCsv -> chaîne),
// incompatible avec un flux borné de 500 000 lignes ; ici on produit ligne par ligne.
const BOM = '\uFEFF';
const EOL = '\r\n';
const SEP = ';';
const HEADER = ['Horodatage local', 'Horodatage UTC (ISO)', 'Automate', 'Variable', 'Valeur', 'Unité', 'Qualité'];

// Cellule texte : anti-injection de formule (Excel) puis guillemets si nécessaire.
function textCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r\n]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Nombre produit par le serveur : jamais préfixé, virgule décimale pour Excel français.
function numberCell(n) {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

function createLocalFormatter(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return (date) => {
    const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  };
}

const headerLine = () => BOM + HEADER.join(SEP) + EOL;

function dataLine({ local, ts, plcName, variableName, value, unit, quality }) {
  return [local, ts.toISOString(), textCell(plcName), textCell(variableName), numberCell(value), textCell(unit), quality]
    .join(SEP) + EOL;
}

module.exports = { BOM, HEADER, textCell, numberCell, createLocalFormatter, headerLine, dataLine };
