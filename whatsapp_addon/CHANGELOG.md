## 1.8.2

- Fixed for Home Assistant 2026.8 and newer: a device now belongs to one integration, so the status sensor could no longer be added to the add-on's device and ended up on a second, unnamed device. The integration now has its own _WhatsApp_ device, linked to the add-on's device as "connected via". The device created by 1.7.x/1.8.x is converted (same device, area kept)
- Replaced the deprecated `device_registry.async_get_device` (stops working in Home Assistant 2027.8)
- Entity name uses the device name: friendly name stays "WhatsApp default status", entity ID unchanged
- The add-on log no longer contains complete Signal session objects with private keys ("Closing session: SessionEntry {...}"); only the message is kept

## 1.8.1

- Fixed: the add-on did not start since 1.7.1 ("FATAL: Unknown log_level: warn"). The option `log_level` clashed with the log level option of the add-on base image, which does not accept `warn`. It is renamed to `whatsapp_log_level`; an old `log_level` setting is ignored

## 1.8.0

- Updated the WhatsApp library Baileys from 6.7.12 (bundled copy) to 7.0.0-rc14 (npm). This fixes recipients getting stuck on "Waiting for this message": Baileys now uses the key bundle sent with a retry request, recreates broken sessions and detects changed identity keys before re-sending
- Messages can be sent to `@lid` IDs (used by WhatsApp in incoming messages)
- Reconnecting backs off (1s, 2s, 4s ... up to 60s) when WhatsApp is unreachable, and repeated identical status updates are no longer sent to Home Assistant
- Smaller image, no native modules (also builds on armhf, armv7 and i386)
- Images are sent without a thumbnail (no image library); the image itself is unchanged
- Make a backup before updating: the existing link is kept, but if WhatsApp asks for a new QR code, restore the backup or scan again

## 1.7.1

- Fixed: the add-on crashed when a WhatsApp message or presence update arrived while Home Assistant was unreachable (for example during a restart)
- Fixed: after being logged out by WhatsApp, removing the old session failed, so no new QR code was shown
- Fixed: adding the integration through the UI on a fresh install failed
- New option `log_level` for the WhatsApp library (Baileys), default `warn`; use `debug` to troubleshoot delivery problems
- The reason of a disconnect is now written to the log

## 1.7.0

- The Whatsapp integration is now set up through the UI (config entry) instead of `whatsapp:` in _configuration.yaml_
- Existing `whatsapp:` YAML is imported automatically on the first restart; afterwards it can be removed (a repair notice tells you so)
- The status sensor is now attached to the add-on's _Whatsapp_ device, next to the update entity
- Existing status sensors keep their entity ID, name and area
- Actions (`whatsapp.send_message` etc.) are unchanged

## 1.6.1

- `sensor.whatsapp_<client>_status` is now a real entity of the custom component with a unique ID, so it can be renamed and managed from the UI (it was created through the API before)
- The sensor is an enum sensor and checks the add-on every minute; it becomes `stopped` when the add-on is not reachable
- New event `whatsapp_status_update` with the full status of a client
- Home Assistant must be restarted once after updating to load the new sensor

## 1.6.0

- Failed requests are no longer silent: the add-on fires a `whatsapp_send_failed` event, creates a persistent notification and answers with an HTTP error
- `whatsapp.send_message` (and the other services) now raise an error in Home Assistant when the add-on could not send, so the automation trace shows the failure and `continue_on_error` can be used for a fallback
- New status sensor `sensor.whatsapp_<client>_status` (connecting, connected, disconnected, qr_code_required, logged_out, stopped) with last error and last sent time
- New `whatsapp_connection_update` event when the connection state changes
- New health endpoint `GET /status`
- Fixed: the error handler itself could crash on errors without a status code

## 1.5.0

- Updated whatsapp library
- Updated docker base image

## 1.4.1

- Bug QR-Code fixed

## 1.4.0

- Updated whatsapp library
- Changed session saving method
- Special functions such as sending buttons, sending lists, etc., are no longer available.

## 1.3.5

- Revert [(Pull request)](https://github.com/giuseppecastaldo/ha-addons/pull/33)

## 1.3.4

- Bug fixed [(Pull request)](https://github.com/giuseppecastaldo/ha-addons/pull/33)
- Bug fixed [(Pull request)](https://github.com/giuseppecastaldo/ha-addons/pull/55)

## 1.3.3

- Added donation button.

## 1.3.2

- Bug fixed.

## 1.3.0

- Bug fixed.

## 1.2.4

- Bug fixed.
- Added patch for receive button on iOS (Attention! iOS receive buttons only if app is open (it seems to be a iOS app bug))

## 1.2.2

- Added the ability to always be online or offline. This could lead to not receiving notifications on other devices. (**Restard required**)
- Bug fixed.

## 1.2.1

- Fixed bug that did not allow the reception of push notifications on other devices.
- Added event presence update.
- Added two more services like subscribe presence and send presence update.

## 1.2.0

- **Changed radically command and events. Please refer to doc and developer tools for change your automations.**
- **Performance boost! (Required re-authentication)**
- Bug fixed on send location.
- Bug fixed on send mulitple buttons.

## 1.1.2

- Bug fixed.
- Performance improvements.

## 1.1.1

- Migration from Home Assistant base image to Debian image

## 1.1.0

- Added the ability to manage multiple whatsapp sessions (re-authentication required)
- Buttons bug fixed (better visibility on android devices)
- Message options bug fixed
- Bug fixed.

**NOTE:** If you have problems with the custom components being updated, please follow this steps:

- Remove Whatsapp configuration in _configuration.yaml_
- Restart Home Assistant
- Add Whatsapp configuration in _configuration.yaml_
- Restart Home Assistant

## 1.0.2

- Addedd message revoke event.
- Added buttons message type (view documentation) (may not work properly on some devices)
- Added set status service (for sets the current user's status message)
- Bug fixed.

## 1.0.1

- Initial release
