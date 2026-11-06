// WhatsApp drops the connection now and then; the add-on is back within a
// few seconds. A request that arrives in that gap waits for the reconnect
// instead of failing, and a request that fails because the connection
// dropped during the send is retried once after the reconnect.
const { isConnectionError } = require("./whatsapp");

const RECONNECT_WAIT_MS = 15e3;

const runWhenConnected = async (
  wapp,
  run,
  { waitMs = RECONNECT_WAIT_MS, log = () => {} } = {}
) => {
  if (!wapp.isConnected) {
    log(`not connected, waiting up to ${waitMs / 1000}s for the reconnect`);
    await wapp.waitUntilConnected(waitMs);
  }

  try {
    return await run();
  } catch (error) {
    if (!isConnectionError(error)) throw error;

    log(`${error.message}; retrying once after the reconnect`);
    await wapp.waitUntilConnected(waitMs, { fresh: wapp.isConnected });
    return run();
  }
};

module.exports = { runWhenConnected, RECONNECT_WAIT_MS };
