# Home Assistant Add-on: Whatsapp add-on

## How to use

### **How to add other Whatsapp sessions**

Go to configuration page in clients input box digit the desired clientId. This one represents an identifier for the session.

### **How to get a User ID**

The user id is made from three parts:

- Country code (Example 39 (Italy))
- User's number
- And a static part: @s.whatsapp.net (for users) @g.us (for groups)

For example for Italian number _3456789010_ the user id is the following _393456789010@s.whatsapp.net_

### **Send a simple text message**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net # User ID
  body:
    text: Hi it's a simple text message
```

### **How to send an image**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net
  body:
    image:
      url: "https://dummyimage.com/600x400/000/fff.png"
    caption: Simple text
```

### **How to send audio message**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net
  body:
    audio:
      url: "https://github.com/giuseppecastaldo/ha-addons/blob/main/whatsapp_addon/examples/hello_world.mp3?raw=true"
    ptt: true # Send audio as a voice
```

### **How to send a location**

```yaml
service: whatsapp.send_message
data:
  clientId: default
  to: 391234567890@s.whatsapp.net
  body:
    location:
      degreesLatitude: 24.121231
      degreesLongitude: 55.1121221
```

### **How to subscribe to presence update**

```yaml
service: whatsapp.presence_subscribe
data:
  clientId: default
  userId: 391234567890@s.whatsapp.net
```

---

## Events

| Event type               | Description                           |
| ------------------------ | ------------------------------------- |
| new_whatsapp_message     | The message that was received         |
| whatsapp_presence_update | Presence of contact in a chat updated |
| whatsapp_send_failed     | A message (or other request) could not be sent. Data: `clientId`, `action`, `to`, `error`, `error_type`, `code` |
| whatsapp_connection_update | Connection state of a client changed. Data: `clientId`, `state`, `previous_state`, `reason` |
| whatsapp_status_update   | Full status of a client (used by the status sensor). Data: `clientId`, `state`, `since`, `last_error`, `last_error_at`, `last_sent_at`, `failed_count` |

## Status sensor

For every client the custom component creates `sensor.whatsapp_<client>_status` (for example `sensor.whatsapp_default_status`). The sensor has a unique ID, so it can be renamed or moved to an area from the UI.

| State            | Meaning                                         |
| ---------------- | ----------------------------------------------- |
| connecting       | Add-on is starting / connecting to WhatsApp     |
| connected        | Ready to send                                   |
| disconnected     | Connection lost, add-on is reconnecting         |
| qr_code_required | Not linked, scan the QR code in notifications   |
| logged_out       | Removed as linked device, scan the QR code again |
| stopped          | Add-on was stopped                              |

Attributes: `since`, `last_error`, `last_error_at`, `last_sent_at`, `failed_count`.

The sensor is updated through the `whatsapp_status_update` event and also checks the add-on every minute. When the add-on cannot be reached the state becomes `stopped`. Restart Home Assistant once after updating the add-on to load the sensor.

## Failure handling

When the add-on cannot send a message, `whatsapp.send_message` fails with an error (visible in the automation trace and the Home Assistant log). Add `continue_on_error: true` to the step if the rest of the automation should still run.

---

## **Sample automations**

## Notify via Telegram when WhatsApp fails

```yaml
- alias: WhatsApp failure to Telegram
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
          ⚠️ WhatsApp client {{ trigger.to_state.attributes.client_id }} is {{ trigger.to_state.state }} ({{ trigger.to_state.attributes.last_error }})
          {% endif %}
  mode: queued
```

## Ping Pong

```yaml
- alias: Ping Pong
  description: ""
  trigger:
    - platform: event
      event_type: new_whatsapp_message
  condition:
    - condition: template
      value_template: "{{ trigger.event.data.message.conversation == '!ping' }}"
  action:
    - service: whatsapp.send_message
      data:
        clientId: default
        to: "{{ trigger.event.data.key.remoteJid }}"
        body:
          text: pong
  mode: single
```

## Arrive at home

```yaml
- alias: Arrive at home
  description: ""
  trigger:
    - platform: device
      domain: device_tracker
      entity_id: device_tracker.iphone_13_pro
      type: enter
      zone: zone.home
  condition: []
  action:
    - service: whatsapp.send_message
      data:
        clientId: default
        to: 391234567890@s.whatsapp.net
        body:
          text: Hi, I'm at home
  mode: single
```

## Driving mode

```yaml
- alias: Driving mode
  description: ""
  trigger:
    - platform: event
      event_type: new_whatsapp_message
  condition: []
  action:
    - service: whatsapp.send_message
      data:
        clientId: "{{ trigger.event.data.clientId }}" # Which instance of whatsapp should the message come from
        to: "{{ trigger.event.data.key.remoteJid }}"
        body:
          text: Sorry, I'm driving, I will contact you soon
        options:
          quoted: "{{ trigger.event.data }}" # Quote message
  mode: single
```

## Message reaction

```yaml
- alias: React to message
  description: ""
  trigger:
    - platform: event
      event_type: new_whatsapp_message
  condition: []
  action:
    - service: whatsapp.send_message
      data:
        clientId: "{{ trigger.event.data.clientId }}"
        to: "{{ trigger.event.data.key.remoteJid }}"
        body:
          react:
            text: "👍🏻" # Use an empty string to remove the reaction
            key: "{{ trigger.event.data.key }}"
  mode: single
```

## Presence notify (SUBSCRIBE FIRST!)

```yaml
- alias: Nuova automazione
  description: ""
  trigger:
    - platform: event
      event_type: whatsapp_presence_update
      event_data: {}
  condition:
    - condition: template
      value_template:
        "{{ trigger.event.data.presences['391234567890@s.whatsapp.net'].lastKnownPresence
        == 'available' }}"
  action:
    - service: persistent_notification.create
      data:
        message: Contact is online!
  mode: single
```
