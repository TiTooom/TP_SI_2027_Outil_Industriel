-- Données de démonstration : un automate simulé et quatre variables process.
-- Le simulateur (J2) expose ces registres holding : 0 température, 1 pression, 2 débit, 3 niveau.

INSERT INTO config.plcs (name, host, port, unit_id) VALUES
  ('Simulateur', 'simulator', 5020, 1);

INSERT INTO config.variables (plc_id, name, register_type, address, data_type, scale, value_offset, unit, frequency_s) VALUES
  (1, 'Température four', 'holding', 0, 'int16',  0.1,  0, '°C',   2),
  (1, 'Pression ligne',   'holding', 1, 'int16',  0.01, 0, 'bar',  2),
  (1, 'Débit pompe',      'holding', 2, 'uint16', 0.1,  0, 'm³/h', 5),
  (1, 'Niveau cuve',      'holding', 3, 'uint16', 0.1,  0, '%',    5);
