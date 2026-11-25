-- Données de démonstration : un automate simulé, quatre variables process (lecture) et deux variables
-- modifiables depuis le tableau de bord (écriture vers le simulateur).
-- Le simulateur expose ces registres holding : 0 température, 1 pression, 2 débit, 3 niveau (recalculés chaque seconde),
-- puis 10 consigne de température (modifiable) ; et le coil 0 « marche pompe » (modifiable).

INSERT INTO config.plcs (name, host, port, unit_id) VALUES
  ('Simulateur', 'simulator', 5020, 1);

INSERT INTO config.variables (plc_id, name, register_type, address, data_type, scale, value_offset, unit, frequency_s) VALUES
  (1, 'Température four', 'holding', 0, 'int16',  0.1,  0, '°C',   2),
  (1, 'Pression ligne',   'holding', 1, 'int16',  0.01, 0, 'bar',  2),
  (1, 'Débit pompe',      'holding', 2, 'uint16', 0.1,  0, 'm³/h', 5),
  (1, 'Niveau cuve',      'holding', 3, 'uint16', 0.1,  0, '%',    5);

INSERT INTO config.variables (plc_id, name, register_type, address, data_type, scale, value_offset, unit, frequency_s, writable) VALUES
  (1, 'Consigne température', 'holding', 10, 'int16', 0.1, 0, '°C', 2, TRUE),
  (1, 'Marche pompe',         'coil',     0, 'bool',  1,   0, '',   2, TRUE);
