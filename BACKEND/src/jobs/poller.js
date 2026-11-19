// Service de relevé : une tâche par variable active, replanifiée à chaud (sans redémarrage).
//
// Pourquoi setInterval et pas node-cron : cron travaille à la minute sur des motifs fixes
// (*/5 * * * *), alors que les fréquences sont des secondes arbitraires (1 s, 7 s, 45 s...).
// Un setInterval par variable est exact et se replanifie par simple clearInterval.
//
// Dépendances injectées (repository, client Modbus, timers) pour tester avec de faux timers.
const { UNKNOWN_STATE, classifyError } = require('../services/plcState');

function createPoller({
  repository,
  modbus,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  reloadRetryMs = 5000,
  now = () => new Date(),
  logger = console,
}) {
  const tasks = new Map(); // variableId -> { signature, timer, busy }
  const plcState = new Map(); // plcId -> état de connexion exposé par /status
  const plcQueues = new Map(); // plcId -> fin de la dernière lecture en file
  let reloadChain = Promise.resolve();
  let stopped = false;
  let retryTimer = null;

  const signature = (t) => JSON.stringify([
    t.plc_id, t.host, t.port, t.unit_id, t.register_type, t.address, t.data_type, t.scale, t.value_offset, t.frequency_s,
  ]);

  function recordState(plcId, error) {
    const at = now().toISOString();
    const prev = plcState.get(plcId) || { last_success_at: null };
    plcState.set(plcId, error
      ? { state: 'offline', last_error: classifyError(error), last_success_at: prev.last_success_at, last_attempt_at: at }
      : { state: 'online', last_error: null, last_success_at: at, last_attempt_at: at });
  }

  async function readAndStore(target) {
    const ts = now();
    let value = null;
    let quality = 'bad';
    try {
      value = await modbus.read(target);
      quality = 'good';
      recordState(target.plc_id, null);
    } catch (err) {
      // Une exception Modbus (adresse illégale...) : l'automate répond, seule cette variable est en défaut.
      recordState(target.plc_id, err.modbusCode === undefined ? err : null);
    }
    try {
      await repository.insertMeasure({ variableId: target.variable_id, ts, value, quality });
    } catch (err) {
      logger.error(`Measure insert failed for variable ${target.variable_id}: ${err.message}`);
    }
  }

  // Lectures sérialisées par automate ; les automates n'attendent pas les uns les autres.
  function enqueue(target) {
    const previous = plcQueues.get(target.plc_id) || Promise.resolve();
    const next = previous.then(() => readAndStore(target));
    plcQueues.set(target.plc_id, next);
    return next;
  }

  function tick(variableId, target) {
    const task = tasks.get(variableId);
    if (!task || task.busy || stopped) return Promise.resolve(); // pas de chevauchement
    task.busy = true;
    return enqueue(target).finally(() => { task.busy = false; });
  }

  function schedule(target) {
    const id = target.variable_id;
    const timer = setIntervalFn(() => { tick(id, target); }, target.frequency_s * 1000);
    tasks.set(id, { signature: signature(target), timer, busy: false });
    tick(id, target); // première mesure immédiate, sans attendre une période
  }

  function cancel(id) {
    const task = tasks.get(id);
    if (task) clearIntervalFn(task.timer);
    tasks.delete(id);
  }

  // Une relecture échouée (BDD indisponible) est retentée seule : sans cela, une modification
  // faite pendant une coupure ne serait jamais appliquée au relevé.
  function scheduleRetry() {
    if (stopped || retryTimer) return;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      reload();
    }, reloadRetryMs);
    if (retryTimer && retryTimer.unref) retryTimer.unref();
  }

  async function doReload() {
    let targets;
    try {
      targets = await repository.loadActiveTargets();
    } catch (err) {
      logger.error(`Poller reload failed, keeping current schedule: ${err.message}`);
      scheduleRetry();
      return false;
    }
    // L'arrêt a pu survenir pendant l'attente de la BDD : ne rien replanifier.
    if (stopped) return false;
    const wanted = new Map(targets.map((t) => [t.variable_id, t]));
    for (const id of [...tasks.keys()]) {
      if (!wanted.has(id)) cancel(id);
    }
    for (const [id, target] of wanted) {
      const existing = tasks.get(id);
      if (existing && existing.signature === signature(target)) continue;
      cancel(id);
      schedule(target);
    }
    const activePlcs = new Set(targets.map((t) => t.plc_id));
    for (const plcId of [...plcState.keys()]) {
      if (!activePlcs.has(plcId)) plcState.delete(plcId);
    }
    return true;
  }

  // Relit la config en BDD. Les rechargements sont sérialisés pour éviter les courses.
  function reload() {
    if (stopped) return Promise.resolve(false);
    reloadChain = reloadChain.then(doReload);
    return reloadChain;
  }

  // Une relecture complète est à peine plus coûteuse qu'une mise à jour ciblée et reste toujours cohérente.
  const syncVariable = () => reload();
  const syncPlc = () => reload();

  // Au démarrage : les échecs sont retentés par reload() lui-même, sans bloquer le serveur.
  function start() {
    reload();
  }

  async function stop() {
    stopped = true;
    if (retryTimer) clearTimeoutFn(retryTimer);
    retryTimer = null;
    // Attendre un rechargement en cours, qui peut avoir planifié des tâches avant de voir l'arrêt.
    await reloadChain.catch(() => {});
    for (const id of [...tasks.keys()]) cancel(id);
    await Promise.allSettled([...plcQueues.values()]);
    modbus.closeAll();
  }

  // Pour /api/plcs/status ; 'unknown' tant qu'aucune lecture n'a été tentée.
  function getPlcState(plcId) {
    return plcState.get(plcId) || UNKNOWN_STATE;
  }

  return { start, stop, reload, syncVariable, syncPlc, getPlcState };
}

module.exports = { createPoller };
