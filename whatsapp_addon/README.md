# Home Assistant app: WhatsApp

_Send and receive WhatsApp messages from Home Assistant._

<img src="https://github.com/gerard33/ha-addons/blob/main/whatsapp_addon/logo.png?raw=true" width="300"/>

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]

The app links to your WhatsApp account as a linked device, like WhatsApp Web, and comes with a Home Assistant integration.

## Features

- `whatsapp.send_message` action: text, images, audio and voice messages, documents, locations, reactions and quoted replies, to contacts and groups
- `new_whatsapp_message` event for incoming messages, so automations can respond to them
- Presence actions and events (online, typing, recording)
- Several WhatsApp accounts side by side (clients)
- Status sensor per client (`connected`, `disconnected`, `logged_out`, ...), with details of the last error and the last disconnect
- Reliable sending: requests that arrive during a short reconnect wait for the connection and are retried once
- When sending fails: a clear error in the automation, a `whatsapp_send_failed` event and a persistent notification

See the **Documentation** tab (DOCS.md) for installation, examples and troubleshooting.

> **Note:** WhatsApp does not allow unofficial clients, so there is no guarantee your number will not be blocked. Consider using a separate number.

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
