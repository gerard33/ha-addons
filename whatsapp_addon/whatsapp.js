const EventEmitter = require("eventemitter2");

// Baileys 7 is an ES module, so it is loaded with import() once
let baileys;
const loadBaileys = async () => (baileys ??= await import("baileys"));

const JID_SUFFIXES = ["@s.whatsapp.net", "@g.us", "@broadcast", "@lid"];
const hasJidSuffix = (id) => JID_SUFFIXES.some((suffix) => id.endsWith(suffix));

const MessageType = {
  text: "conversation",
  location: "locationMessage",
  liveLocation: "liveLocationMessage",
  image: "imageMessage",
  video: "videoMessage",
  document: "documentMessage",
  contact: "contactMessage",
};

class WhatsappClient extends EventEmitter {
  #conn;
  #msgStore = new Map();
  #path;
  #refreshInterval;
  #sendPresenceUpdateInterval;
  #timeout;
  #attempts;
  #offline;
  #refreshMs;
  #logLevel;

  #status = {
    attempt: 0,
    connected: false,
    disconnected: false,
    reconnecting: false,
  };

  #toMilliseconds = (hrs, min, sec) => (hrs * 60 * 60 + min * 60 + sec) * 1000;

  constructor({
    path,
    timeout = 1e3,
    attempts = Infinity,
    offline = true,
    refreshMs,
    logLevel = "warn",
  }) {
    super();
    this.#path = path;
    this.#timeout = timeout;
    this.#attempts = attempts;
    this.#offline = offline;
    this.#refreshMs = refreshMs || this.#toMilliseconds(6, 0, 0);
    this.#logLevel = logLevel;
    this.connect();
  }

  connect = async () => {
    if (this.#status.connected) return;

    const {
      default: makeWASocket,
      fetchLatestBaileysVersion,
      useMultiFileAuthState,
      isJidStatusBroadcast,
      isJidNewsletter,
    } = await loadBaileys();

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(this.#path);

    this.#conn = makeWASocket({
      version,
      auth: state,
      syncFullHistory: false,
      markOnlineOnConnect: !this.#offline,
      logger: require("pino")({ level: this.#logLevel }),
      generateHighQualityLinkPreview: true,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      defaultQueryTimeoutMs: undefined,
      getMessage: async (key) => this.#msgStore.get(key.id),
      // Status updates (stories) and channels are not used by the add-on.
      // Ignoring them also stops decrypt failures on statuses, which made
      // Baileys ask the phone to resend them ("sync successful" on the
      // phone) after every reconnect.
      shouldIgnoreJid: (jid) =>
        !!jid && (isJidStatusBroadcast(jid) || isJidNewsletter(jid)),
    });

    this.#conn.ev.on("creds.update", (state) => {
      if (state.me) {
        this.emit("pair", {
          phone: state.me.id.split(":")[0],
          name: state.me.name,
        });
      }

      saveCreds(state);
    });

    this.#conn.ev.on("connection.update", this.#onConnectionUpdate);
  };

  disconnect = (reconnect) => {
    if (this.#status.disconnected) return;

    this.#status.connected = false;
    this.#status.disconnected = !reconnect;
    this.#status.reconnecting = !!reconnect;

    return this.#conn.end();
  };

  restart = () => {
    this.emit("restart");
    return this.disconnect(true);
  };

  #toId = (phone) => {
    phone = phone.toString();
    if (!phone) throw new Error("Invalid phone");

    return `${phone.replace("+", "")}${hasJidSuffix(phone) ? "" : "@s.whatsapp.net"}`;
  };

  #reconnect = () => {
    if (this.#status.attempt++ > this.#attempts || this.#status.disconnected) {
      this.#status.reconnecting = false;
      this.#status.disconnected = true;
      return;
    }

    // Back off when WhatsApp stays unreachable: 1s, 2s, 4s ... max 60s
    const delay = Math.min(this.#timeout * 2 ** (this.#status.attempt - 1), 60e3);
    setTimeout(this.connect, delay);
  };

  #onConnectionUpdate = (event) => {
    if (event.qr) this.#onQr(event.qr);
    if (event.connection === "open") this.#onConnected(event);
    else if (event.connection === "close") this.#onDisconnected(event);
  };

  #onQr = (qr) => {
    this.emit("qr", qr);
  };

  #onConnected = (event) => {
    this.#status.attempt = 0;
    this.#status.connected = true;
    this.#status.disconnected = false;
    this.#status.reconnecting = false;

    this.#refreshInterval = setInterval(() => this.restart(), this.#refreshMs);
    if (this.#offline) this.setSendPresenceUpdateInterval("unavailable");

    this.#conn.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];

      if (msg?.message && !msg.key?.fromMe) {
        delete msg.message.messageContextInfo;
        const messageType = Object.keys(msg.message)[0];
        this.emit("msg", { type: messageType, ...msg });
      }
    });

    this.#conn.ev.on("presence.update", (presence) => {
      this.emit("presence_update", presence);
    });

    this.emit("ready");
  };

  #onDisconnected = ({ lastDisconnect }) => {
    this.#status.connected = false;

    clearInterval(this.#refreshInterval);
    this.setSendPresenceUpdateInterval();

    const statusCode = lastDisconnect?.error?.output?.statusCode;

    if (statusCode === baileys?.DisconnectReason.loggedOut) {
      this.#status.reconnecting = false;
      this.#status.disconnected = true;

      this.emit("logout");
      return;
    }

    this.emit("disconnected", statusCode);
    this.#reconnect();
  };

  setSendPresenceUpdateInterval = (status, id) => {
    clearInterval(this.#sendPresenceUpdateInterval);

    if (status) {
      try {
        this.sendPresenceUpdate(status, id);
      } catch (err) {
        clearInterval(this.#sendPresenceUpdateInterval);
      }

      this.#sendPresenceUpdateInterval = setInterval(() => {
        try {
          this.sendPresenceUpdate(status, id);
        } catch (err) {
          clearInterval(this.#sendPresenceUpdateInterval);
        }
      }, 10000);
    }
  };

  sendMessage = async (phone, msg, options) => {
    phone = phone.toString();
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    const id = this.#toId(phone);

    // Full JIDs (also @lid, used by Baileys 7 in incoming messages) are sent
    // as is; plain phone numbers are checked first
    let exists = hasJidSuffix(phone);
    if (!exists) {
      const [result] = (await this.#conn.onWhatsApp(id)) || [];
      exists = !!result?.exists;
    }

    if (exists) {
      try {
        const result = await this.#conn.sendMessage(id, msg, options);
        if (result?.key?.id && result.message) {
          this.#msgStore.set(result.key.id, result.message);
          if (this.#msgStore.size > 500)
            this.#msgStore.delete(this.#msgStore.keys().next().value);
        }
        return result;
      } catch (err) {
        throw toWhatsappError(err);
      }
    }

    throw new WhatsappNumberNotFoundError(phone);
  };

  waitForMessage(from, callback) {
    this.once("msg", (msg) => {
      if (msg.key.remoteJid === this.#toId(from)) callback(msg);
    });
  }

  sendPresenceUpdate = async (type, id) => {
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    try {
      await this.#conn.sendPresenceUpdate(type, id);
    } catch (err) {
      throw toWhatsappError(err);
    }
  };

  presenceSubscribe = async (phone) => {
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    const id = this.#toId(phone);

    let exists = id.endsWith("@lid");
    if (!exists) {
      const [result] = (await this.#conn.onWhatsApp(id)) || [];
      exists = !!result?.exists;
    }

    if (exists) {
      try {
        await this.#conn.presenceSubscribe(id);
      } catch (err) {
        throw toWhatsappError(err);
      }
    } else {
      throw new WhatsappNumberNotFoundError(phone);
    }
  };

  updateProfileStatus = async (status) => {
    if (this.#status.disconnected || !this.#status.connected) {
      throw new WhatsappDisconnectedError();
    }

    try {
      await this.#conn.updateProfileStatus(status);
    } catch (err) {
      throw toWhatsappError(err);
    }
  };
}

// Baileys errors (Boom) carry a status code; other errors do not
const toWhatsappError = (err) => {
  const statusCode = err?.output?.payload?.statusCode;
  if (statusCode) return new WhatsappError(statusCode);

  const error = new Error(
    `Send message failed. ${err?.message || "Unknown error"}`
  );
  error.name = "WhatsappError";
  return error;
};

class WhatsappNumberNotFoundError extends Error {
  constructor(phone = "", ...args) {
    super(phone, ...args);
    this.name = "WhatsappNumberNotFoundError";
    this.message = `Send message failed. Number ${phone} is not on Whatsapp.`;
    this.code = 404;
  }
}

class WhatsappDisconnectedError extends Error {
  constructor(message = "", ...args) {
    super(message, ...args);
    this.name = "WhatsappDisconnectedError";
    this.code = 401;
    this.message = `Send message failed. Whatsapp disconnected error.`;
  }
}

class WhatsappError extends Error {
  #errors = {
    428: "Connection Closed",
    440: "Connection Replaced",
    408: "Timed Out",
    401: "Logged Out",
    500: "Bad Session",
    515: "Restart Required",
    411: "Multidevice Mismatch",
  };

  constructor(message = "", ...args) {
    super(message, ...args);
    this.name = "WhatsappError";
    this.code = Number(this.message);
    this.message = `Send message failed. Whatsapp error ${this.message}: ${
      this.#errors[this.code] ?? "Unknown"
    }`;
  }
}

module.exports = { WhatsappClient, MessageType };
