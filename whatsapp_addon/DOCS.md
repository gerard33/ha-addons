# Home Assistant app: WhatsApp

Send and receive WhatsApp messages from Home Assistant. The app connects to WhatsApp as a linked device (like WhatsApp Web) and installs a Home Assistant integration that provides the actions, events and a status sensor.

> **Note:** WhatsApp does not allow unofficial clients. There is no guarantee your number will not be blocked. Consider using a separate number.

## Installation

1. Add the repository `https://github.com/gerard33/ha-addons` (**Settings → Apps → App store → ⋮ → Repositories**), then install the **WhatsApp** app.
2. Start the app. After a few seconds a notification with a QR code appears in Home Assistant.
3. On your phone, open WhatsApp → **Settings → Linked devices → Link a device** and scan the QR code. The notification disappears once the client is connected.
4. Restart Home Assistant once. The app copies its integration to `custom_components/whatsapp`, and Home Assistant only loads it after a restart.
5. Add the integration: **Settings → Devices & services → Add integration → Whatsapp**. You now have the `whatsapp.*` actions and a status sensor on the _WhatsApp_ device.

**Upgrading from a version with `whatsapp:` in `configuration.yaml`:** the integration is added automatically on the first restart. Remove `whatsapp:` from `configuration.yaml` afterwards; Home Assistant shows a repair notice for it.

**After an update** of the app, restart Home Assistant only when the changelog says the integration changed.

## Configuration

```yaml
clients:
  - default
whatsapp_log_level: warn
```

| Option | Description |
| --- | --- |
| `clients` | One entry per WhatsApp account. The name is the `clientId` you use in actions; each client gets its own QR code and status sensor. Add a name to link a second account. |
| `whatsapp_log_level` | Log level of the WhatsApp library (Baileys): `trace`, `debug`, `info`, `warn` (default), `error` or `silent`. Use `error` for a quiet log. Use `debug` temporarily to investigate delivery problems; it is very verbose. |

The app's own messages, such as connection changes and `disconnect details`, are always logged.

## Recipients

The `to` field (and `userId` for presence) accepts:

| Recipient | Format | Example |
| --- | --- | --- |
| Contact | Country code + number, without `+` or leading zero, followed by `@s.whatsapp.net` | `31612345678@s.whatsapp.net` |
| Contact (short) | Country code + number; `+` is allowed | `31612345678` or `+31612345678` |
| Group | Group ID followed by `@g.us` | `120363012345678901@g.us` |

For contacts the app first checks that the number is on WhatsApp; if it is not, the action fails with _number not found_.

To find a group ID, send a message in the group and look at `key.remoteJid` of the `new_whatsapp_message` event (**Developer tools → Events**, listen to `new_whatsapp_message`).

## Actions

All actions need `clientId`, the client name from the configuration (usually `default`).

### `whatsapp.send_message`

| Field | Description |
| --- | --- |
| `clientId` | Client to send from |
| `to` | Recipient, see **Recipients** above |
| `body` | Message content, see the examples below |
| `options` | Optional, for example `quoted` to reply to a message |

**Text**

```yaml
action: whatsapp.send_message
data:
  clientId: default
  to: 31612345678@s.whatsapp.net
  body:
    text: Hi, this is a simple text message
```

**Image** (from a URL; `caption` is optional)

```yaml
action: whatsapp.send_message
data:
  clientId: default
  to: 31612345678@s.whatsapp.net
  body:
    image:
      url: "https://dummyimage.com/600x400/000/fff.png"
    caption: Simple text
```

**Audio** (`ptt: true` sends it as a voice message)

```yaml
action: whatsapp.send_message
data:
  clientId: default
  to: 31612345678@s.whatsapp.net
  body:
    audio:
      url: "https://github.com/gerard33/ha-addons/blob/main/whatsapp_addon/examples/hello_world.mp3?raw=true"
    ptt: true
```

**Document**

```yaml
action: whatsapp.send_message
data:
  clientId: default
  to: 31612345678@s.whatsapp.net
  body:
    document:
      url: "https://example.com/report.pdf"
    mimetype: application/pdf
    fileName: report.pdf
```

**Location**

```yaml
action: whatsapp.send_message
data:
  clientId: default
  to: 31612345678@s.whatsapp.net
  body:
    location:
      degreesLatitude: 52.370216
      degreesLongitude: 4.895168
```

**Reaction** to a received message (use an empty `text` to remove it)

```yaml
action: whatsapp.send_message
data:
  clientId: "{{ trigger.event.data.clientId }}"
  to: "{{ trigger.event.data.key.remoteJid }}"
  body:
    react:
      text: "👍"
      key: "{{ trigger.event.data.key }}"
```

**Reply** that quotes a received message

```yaml
action: whatsapp.send_message
data:
  clientId: "{{ trigger.event.data.clientId }}"
  to: "{{ trigger.event.data.key.remoteJid }}"
  body:
    text: Sorry, I'm driving, I will contact you soon
  options:
    quoted: "{{ trigger.event.data }}"
```

URLs must be reachable from the app. A file from Home Assistant's `www` folder can be used as `http://homeassistant.local:8123/local/<file>` (or your own Home Assistant address).

### `whatsapp.set_status`

Sets the About text of the linked account.

```yaml
action: whatsapp.set_status
data:
  clientId: default
  status: Available
```

### `whatsapp.send_presence_update`

Sends a presence. `type`: `available`, `unavailable`, `composing` (typing), `recording` or `paused`. `composing`, `recording` and `paused` need `to` (the chat where it is shown); `available` and `unavailable` without `to` set your general online state.

```yaml
action: whatsapp.send_presence_update
data:
  clientId: default
  type: composing
  to: 31612345678@s.whatsapp.net
```

### `whatsapp.send_infinity_presence_update`

Same fields as `send_presence_update`, but the presence is sent again every 10 seconds until another infinity presence is set or the app restarts. Use it to stay `available`, for example for `presence_subscribe`.

### `whatsapp.presence_subscribe`

Subscribes to the presence of a contact. Updates arrive as `whatsapp_presence_update` events. WhatsApp only sends presence updates while your own account is `available`, so use `send_infinity_presence_update` with `type: available` first.

```yaml
action: whatsapp.presence_subscribe
data:
  clientId: default
  userId: 31612345678@s.whatsapp.net
```

## Events

All events carry `clientId`.

| Event | When | Data |
| --- | --- | --- |
| `new_whatsapp_message` | A message is received (own messages, status updates and channels are not forwarded) | The WhatsApp message: `key` (`remoteJid`, `id`, ...), `message` (for example `message.conversation` for plain text), `pushName`, `type` |
| `whatsapp_presence_update` | Presence of a subscribed contact changed | `id`, `presences` |
| `whatsapp_send_failed` | An action could not be executed | `action`, `to`, `error`, `error_type`, `code` |
| `whatsapp_connection_update` | Connection state of a client changed | `state`, `previous_state`, `reason`, `details` (on disconnect) |
| `whatsapp_status_update` | Full status of a client; used by the status sensor | `state`, `since`, `last_error`, `last_error_at`, `last_sent_at`, `failed_count`, `last_disconnect` |

Tip: listen to an event in **Developer tools → Events** to see its exact data.

## Status sensor

Every client gets `sensor.whatsapp_<client>_status`, for example `sensor.whatsapp_default_status`. It belongs to the _WhatsApp_ device of the integration and can be renamed or moved to an area.

| State | Meaning |
| --- | --- |
| `connecting` | The app is starting or connecting to WhatsApp |
| `connected` | Ready to send |
| `disconnected` | Connection lost; the app is reconnecting |
| `qr_code_required` | Not linked yet: scan the QR code from the notification |
| `logged_out` | Removed as linked device: scan the new QR code |
| `stopped` | The app is stopped or cannot be reached |

| Attribute | Description |
| --- | --- |
| `since` | When the current state started |
| `last_error`, `last_error_at` | Last error and when it happened |
| `last_sent_at` | When the last message was sent |
| `failed_count` | Number of failed actions since the app started |
| `last_disconnect` | Details of the last disconnect, see below |

`last_disconnect` contains `code`, `reason`, `closed_by`, `ws_close_code`, `ws_close_reason`, `socket_error`, `connected_seconds` (how long the connection was up), `last_received_seconds` (how long before the disconnect WhatsApp last sent data), `remote` (WhatsApp server) and `local_port`. `closed_by` is `network (no close frame)` when the connection was dropped on the way and `whatsapp (...)` when WhatsApp closed it.

The sensor is updated through the `whatsapp_status_update` event and also checks the app every minute.

## Failure handling

WhatsApp closes the connection now and then; the app reconnects within a few seconds. A few short disconnects a day are normal.

- A request that arrives while the app is reconnecting waits up to 15 seconds for the connection instead of failing straight away.
- When the connection drops during a send (WhatsApp error 408, 428, 503 or 515), the request is retried once after the reconnect.
- Other errors, such as a number that is not on WhatsApp, are not retried.

When an action still fails:

- the action step fails with the error, visible in the automation trace and the Home Assistant log. Add `continue_on_error: true` to the step if the rest of the automation should still run;
- a `whatsapp_send_failed` event is fired;
- a persistent notification is shown;
- `failed_count` and `last_error` of the status sensor are updated.

## Example automations

### Notify via Telegram when WhatsApp fails

```yaml
- alias: WhatsApp failure to Telegram
  mode: queued
  triggers:
    - trigger: event
      event_type: whatsapp_send_failed
      id: failed
    - trigger: state
      entity_id: sensor.whatsapp_default_status
      to:
        - disconnected
        - logged_out
        - qr_code_required
        - stopped
      for:
        minutes: 5
      id: status
  actions:
    - action: notify.telegram
      data:
        message: >-
          {% if trigger.id == 'failed' %}
          ⚠️ WhatsApp: {{ trigger.event.data.action }} to {{ trigger.event.data.to }} failed: {{ trigger.event.data.error }}
          {% else %}
          ⚠️ WhatsApp client {{ trigger.to_state.attributes.client_id }} is {{ trigger.to_state.state }}
          {%- if trigger.to_state.attributes.last_error %} ({{ trigger.to_state.attributes.last_error }}){% endif %}
          {% endif %}
```

### Fall back to Telegram for one message

```yaml
- alias: Reminder via WhatsApp, Telegram as fallback
  triggers:
    - trigger: time
      at: "21:30:00"
  actions:
    - parallel:
        - action: whatsapp.send_message
          continue_on_error: true
          data:
            clientId: default
            to: 31612345678@s.whatsapp.net
            body:
              text: Reminder
        - sequence:
            - wait_for_trigger:
                - trigger: event
                  event_type: whatsapp_send_failed
                  event_data:
                    to: 31612345678@s.whatsapp.net
              timeout: "00:01:00"
              continue_on_timeout: false
            - action: notify.telegram
              data:
                message: "Reminder (WhatsApp failed: {{ wait.trigger.event.data.error }})"
```

### Ping pong

```yaml
- alias: Ping pong
  triggers:
    - trigger: event
      event_type: new_whatsapp_message
  conditions:
    - condition: template
      value_template: "{{ trigger.event.data.message.conversation == '!ping' }}"
  actions:
    - action: whatsapp.send_message
      data:
        clientId: "{{ trigger.event.data.clientId }}"
        to: "{{ trigger.event.data.key.remoteJid }}"
        body:
          text: pong
```

### Arrive at home

```yaml
- alias: Arrive at home
  triggers:
    - trigger: state
      entity_id: person.john
      to: home
  actions:
    - action: whatsapp.send_message
      data:
        clientId: default
        to: 31612345678@s.whatsapp.net
        body:
          text: Hi, I'm at home
```

### Contact comes online (subscribe first)

```yaml
- alias: Contact online
  triggers:
    - trigger: event
      event_type: whatsapp_presence_update
  conditions:
    - condition: template
      value_template: >-
        {{ trigger.event.data.presences['31612345678@s.whatsapp.net'].lastKnownPresence == 'available' }}
  actions:
    - action: persistent_notification.create
      data:
        message: Contact is online!
```

## Troubleshooting

| Problem | What to do |
| --- | --- |
| No QR code notification | Check the app log. When the status sensor shows `qr_code_required`, the notification should be there; restart the app if it is not. |
| Status `logged_out` | The linked device was removed on the phone. A new QR code appears in the notifications; scan it again. |
| `whatsapp.*` actions missing | Restart Home Assistant once after installing the app, then add the **Whatsapp** integration. |
| Action fails with _number not found_ | Check the country code and remove a leading zero: `31612345678`, not `0612345678`. |
| Recipient sees "Waiting for this message" | Usually resolves by itself after a reconnect. Set `whatsapp_log_level` to `debug` temporarily to see what happens with delivery. |
| Frequent disconnects | A few a day are normal. The `disconnect details` lines in the log and the `last_disconnect` attribute show who closed the connection and when. |
| `failed to find key ... to decode mutation` in the log | Syncing of chat settings (pinned, archived, muted chats). It does not affect sending. Set `whatsapp_log_level` to `error` to hide it, or link the device again to fix it. |
