const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
// libsignal (used by Baileys) logs complete session objects, including
// private keys, when it opens or closes a session. Keep only the message,
// so no key material ends up in the add-on log.
const SESSION_LOG = /^(Closing session|Opening session|Removing old closed session|Session already closed)/;
for (const method of ["log", "info", "warn"]) {
  const original = console[method].bind(console);
  console[method] = (first, ...rest) =>
    typeof first === "string" && SESSION_LOG.test(first)
      ? original(first.replace(/:\s*$/, ""))
      : original(first, ...rest);
}

const { WhatsappClient } = require("./whatsapp");
const { runWhenConnected } = require("./reconnect");

var logger = require("log4js").getLogger();
logger.level = "info";

var qrimage = require("qr-image");

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const clients = {};

// ---------------------------------------------------------------------------
// Home Assistant helpers
// ---------------------------------------------------------------------------

const haPost = (path, data) =>
  axios
    .post(`http://supervisor/core/api/${path}`, data, {
      headers: {
        Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`,
      },
    })
    .catch((error) =>
      logger.warn(`Could not reach Home Assistant (${path}): ${error.message}`)
    );

// Connection status per client. The custom component turns the
// whatsapp_status_update event into sensor.whatsapp_<client>_status
const clientStatus = {};

const statusPayload = (key) => {
  const status = clientStatus[key];
  return {
    clientId: key,
    state: status.state,
    since: status.since,
    last_error: status.lastError ?? null,
    last_error_at: status.lastErrorAt ?? null,
    last_sent_at: status.lastSentAt ?? null,
    failed_count: status.failedCount ?? 0,
    last_disconnect: status.lastDisconnect ?? null,
  };
};

const publishStatus = (key) => {
  if (!clientStatus[key]) return;
  return haPost("events/whatsapp_status_update", statusPayload(key));
};

const setStatus = (key, state, extra = {}) => {
  const previous = clientStatus[key];
  // Nothing new (e.g. repeated reconnect attempts): do not flood HA
  if (
    previous?.state === state &&
    Object.entries(extra).every(([k, v]) => k.endsWith("At") || k === "lastDisconnect" || previous[k] === v)
  )
    return;

  clientStatus[key] = {
    failedCount: 0,
    ...previous,
    ...extra,
    state,
    since: previous?.state === state ? previous.since : new Date().toISOString(),
  };

  if (previous?.state !== state) {
    logger.info(
      `${key} connection state: ${state}` +
        (extra.lastError ? ` (${extra.lastError})` : "")
    );
    haPost("events/whatsapp_connection_update", {
      clientId: key,
      state,
      previous_state: previous?.state ?? null,
      reason: extra.lastError ?? null,
      ...(state === "disconnected" ? { details: extra.lastDisconnect ?? null } : {}),
    });
  }

  publishStatus(key);
};

// Called whenever something could not be sent / executed by the addon
const reportFailure = (action, key, request, error) => {
  const message = error?.message || String(error);
  logger.error(`${action} failed for client ${key ?? "?"}: ${message}`);

  const now = new Date().toISOString();
  if (key && clientStatus[key]) {
    clientStatus[key].lastError = message;
    clientStatus[key].lastErrorAt = now;
    clientStatus[key].failedCount = (clientStatus[key].failedCount || 0) + 1;
    publishStatus(key);
  }

  haPost("events/whatsapp_send_failed", {
    clientId: key ?? null,
    action,
    to: request?.to ?? request?.userId ?? null,
    error: message,
    error_type: error?.name ?? "Error",
    code: error?.code ?? null,
  });

  haPost("services/persistent_notification/create", {
    title: "WhatsApp: versturen mislukt",
    message: `**${action}** via client **${key ?? "?"}** is mislukt` +
      (request?.to ? ` (naar \`${request.to}\`)` : "") +
      `.\n\nFout: ${message}\n\nTijd: ${now}`,
    notification_id: `whatsapp_addon_failure_${key ?? "unknown"}`,
  });
};

// Every request goes through here so failures are handled the same way
const handleRequest = (action, req, res, run) => {
  const request = req.body || {};
  const key = request.clientId;

  if (!key) {
    const error = new Error("Please specify client ID.");
    reportFailure(action, key, request, error);
    return res.status(400).send(`KO: ${error.message}`);
  }

  if (!clients.hasOwnProperty(key)) {
    const error = new Error(`Client ID '${key}' not found.`);
    reportFailure(action, key, request, error);
    return res.status(404).send(`KO: ${error.message}`);
  }

  const wapp = clients[key];
  runWhenConnected(wapp, () => run(wapp, request), {
    log: (message) => logger.info(`${action} (${key}): ${message}`),
  })
    .then(() => {
      if (action === "Send message") {
        clientStatus[key].lastSentAt = new Date().toISOString();
        publishStatus(key);
      }
      res.send("OK");
    })
    .catch((error) => {
      reportFailure(action, key, request, error);
      res.status(500).send(`KO: ${error?.message || error}`);
    });
};

const onReady = (key) => {
  logger.info(key, "client is ready.");
  haPost("services/persistent_notification/dismiss", {
    notification_id: `whatsapp_addon_qrcode_${key}`,
  });
  setStatus(key, "connected", { lastError: null });
};

const formatSeconds = (s) =>
  s == null ? "?" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;

const onDisconnected = (statusCode, key, details = {}) => {
  // One line per disconnect with everything needed to find the cause
  logger.info(
    `${key} disconnect details: code ${statusCode ?? "?"} "${details.reason ?? "?"}", ` +
      `closed by ${details.closed_by ?? "?"}` +
      (details.ws_close_code ? ` (ws ${details.ws_close_code}${details.ws_close_reason ? ` ${details.ws_close_reason}` : ""})` : "") +
      (details.socket_error ? `, socket error ${details.socket_error}` : "") +
      `, connected ${formatSeconds(details.connected_seconds)}` +
      `, last data from WhatsApp ${formatSeconds(details.last_received_seconds)} ago` +
      (details.remote ? `, server ${details.remote}, local port ${details.local_port}` : "")
  );

  setStatus(key, "disconnected", {
    lastError: `Connection closed (code ${statusCode ?? "unknown"})`,
    lastErrorAt: new Date().toISOString(),
    lastDisconnect: { code: statusCode ?? null, ...details },
  });
};

const onQr = (qr, key) => {
  logger.info(
    key,
    "require authentication over QRCode, please see your notifications..."
  );

  setStatus(key, "qr_code_required");

  var code = qrimage.image(qr, { type: "png" });

  code.on("readable", function () {
    var img_string = code.read().toString("base64");
    haPost("services/persistent_notification/create", {
      title: `Whatsapp QRCode (${key})`,
      message: `Please scan the following QRCode for **${key}** client... ![QRCode](data:image/png;base64,${img_string})`,
      notification_id: `whatsapp_addon_qrcode_${key}`,
    });
  });
};

const onMsg = (msg, key) => {
  haPost("events/new_whatsapp_message", { clientId: key, ...msg });
  logger.debug(`New message event fired from ${key}.`);
};

const onPresenceUpdate = (presence, key) => {
  haPost("events/whatsapp_presence_update", { clientId: key, ...presence });
  logger.debug(`New presence event fired from ${key}.`);
};

const onLogout = async (key) => {
  logger.info(`Client ${key} was logged out. Restarting...`);
  setStatus(key, "logged_out", {
    lastError: "Logged out by WhatsApp, scan the QR code again.",
    lastErrorAt: new Date().toISOString(),
  });
  try {
    fs.rmSync(`/data/${key}`, { recursive: true, force: true });
  } catch (error) {
    logger.error(`Could not remove session of ${key}: ${error.message}`);
  }

  init(key);
};

let baileysLogLevel = "warn";

const init = (key) => {
  setStatus(key, "connecting");
  clients[key] = new WhatsappClient({
    path: `/data/${key}`,
    logLevel: baileysLogLevel,
  });

  clients[key].on("restart", () => logger.debug(`${key} client restarting...`));
  clients[key].on("qr", (qr) => onQr(qr, key));
  clients[key].on("ready", () => onReady(key));
  clients[key].on("disconnected", (statusCode, details) =>
    onDisconnected(statusCode, key, details)
  );
  clients[key].on("msg", (msg) => onMsg(msg, key));
  clients[key].on("logout", () => onLogout(key));
  clients[key].on("presence_update", (presence) =>
    onPresenceUpdate(presence, key)
  );
};

fs.readFile("data/options.json", function (error, content) {
  var options = JSON.parse(content);
  // Not "log_level": the add-on base image reads that option itself and
  // stops the container on values it does not know (such as "warn")
  baileysLogLevel = options.whatsapp_log_level || "warn";
  logger.info(`WhatsApp library log level: ${baileysLogLevel}`);

  options.clients.forEach((key) => {
    init(key);
  });

  app.listen(port, () => logger.info(`Whatsapp Addon started.`));

  app.post("/sendMessage", (req, res) =>
    handleRequest("Send message", req, res, (wapp, message) =>
      wapp.sendMessage(message.to, message.body, message.options)
    )
  );

  app.post("/setStatus", (req, res) =>
    handleRequest("Set status", req, res, (wapp, request) =>
      wapp.updateProfileStatus(request.status)
    )
  );

  app.post("/presenceSubscribe", (req, res) =>
    handleRequest("Presence subscribe", req, res, (wapp, request) =>
      wapp.presenceSubscribe(request.userId)
    )
  );

  app.post("/sendPresenceUpdate", (req, res) =>
    handleRequest("Presence update", req, res, (wapp, request) =>
      wapp.sendPresenceUpdate(request.type, request.to)
    )
  );

  app.post("/sendInfinityPresenceUpdate", (req, res) =>
    handleRequest("Infinity presence update", req, res, (wapp, request) =>
      wapp.setSendPresenceUpdateInterval(request.type, request.to)
    )
  );

  // Status of every client. Also polled by the custom component, so the
  // sensor is correct after a Home Assistant restart.
  // HTTP 200 when every client is connected, 503 otherwise.
  app.get("/status", (req, res) => {
    const clientIds = Object.keys(clientStatus);
    const allConnected = clientIds.every(
      (key) => clientStatus[key].state === "connected"
    );
    res
      .status(allConnected ? 200 : 503)
      .json(Object.fromEntries(clientIds.map((key) => [key, statusPayload(key)])));
  });
});

const onStop = async () => {
  logger.info("Whatsapp Addon stopping.");
  await Promise.all(
    Object.keys(clientStatus).map((key) => {
      clientStatus[key].state = "stopped";
      clientStatus[key].since = new Date().toISOString();
      return publishStatus(key);
    })
  );
  process.exit(0);
};

process.on("SIGTERM", onStop);
process.on("SIGINT", onStop);

// Safety net: never let a stray promise rejection stop the add-on
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled error: ${reason?.stack || reason}`);
});
