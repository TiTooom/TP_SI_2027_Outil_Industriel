const { Router } = require('express');
const { apiPool, pollerPool } = require('../db/pools');

const PING_TIMEOUT_MS = 2000;

// Ne lève jamais : une base injoignable donne simplement "down".
async function ping(pool) {
  let timer;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), PING_TIMEOUT_MS); }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

const router = Router();

router.get('/', async (req, res) => {
  const [api, poller] = await Promise.all([ping(apiPool), ping(pollerPool)]);
  const ok = api === 'up' && poller === 'up';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    uptime_s: Math.round(process.uptime()),
    db: { api, poller },
  });
});

module.exports = router;
