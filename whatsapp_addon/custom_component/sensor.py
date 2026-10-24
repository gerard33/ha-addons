"""Connection status sensor per WhatsApp client."""
from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util, slugify

from .const import DOMAIN, EVENT_STATUS_UPDATE, HASSIO_DOMAIN
from .whatsapp import ADDON_SLUG, WhatsappAddonError

POLL_INTERVAL = timedelta(seconds=60)

STATES = [
    "connecting",
    "connected",
    "disconnected",
    "qr_code_required",
    "logged_out",
    "stopped",
]

ATTRIBUTES = ["since", "last_error", "last_error_at", "last_sent_at", "failed_count"]

_LOGGER = logging.getLogger(__name__)


OWN_IDENTIFIER = (DOMAIN, ADDON_SLUG)
ADDON_IDENTIFIER = (HASSIO_DOMAIN, ADDON_SLUG)


def _find_addon_device(hass: HomeAssistant) -> dr.DeviceEntry | None:
    """Return the add-on's device created by the Supervisor integration."""
    dev_reg = dr.async_get(hass)
    if hasattr(dev_reg, "async_get_devices"):
        # HA 2026.8+: identifiers are only unique per config entry
        for device in dev_reg.async_get_devices(identifiers={ADDON_IDENTIFIER}):
            owner = hass.config_entries.async_get_entry(device.config_entry_id)
            if owner is not None and owner.domain == HASSIO_DOMAIN:
                return device
        return None
    return dev_reg.async_get_device(identifiers={ADDON_IDENTIFIER})


def _owned_only_by(device: dr.DeviceEntry, entry_id: str) -> bool:
    if hasattr(device, "config_entry_id"):  # HA 2026.8+: one entry per device
        return device.config_entry_id == entry_id
    return set(device.config_entries) == {entry_id}


@callback
def _migrate_device(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Give a device created by 1.7.x/1.8.x our own identifier.

    1.7.0 attached the sensor to the add-on device by using its Supervisor
    identifier. Since HA 2026.8 a device belongs to one config entry, so that
    created a second device with the Supervisor identifier for this entry.
    Re-key it (keeps the device id, area and entity), so it does not clash.
    """
    dev_reg = dr.async_get(hass)
    devices = dr.async_entries_for_config_entry(dev_reg, entry.entry_id)
    if any(OWN_IDENTIFIER in device.identifiers for device in devices):
        return
    for device in devices:
        if ADDON_IDENTIFIER in device.identifiers and _owned_only_by(
            device, entry.entry_id
        ):
            _LOGGER.debug("Migrating device %s to own identifier", device.id)
            dev_reg.async_update_device(
                device.id, new_identifiers={OWN_IDENTIFIER}
            )
            return


def _device_info(hass: HomeAssistant) -> DeviceInfo:
    """Own device, shown as connected via the add-on's Supervisor device.

    Entities cannot be added to a device of another integration (since HA
    2026.8 a device belongs to exactly one config entry), so the add-on device
    is linked as via device instead.
    """
    info = DeviceInfo(
        identifiers={OWN_IDENTIFIER},
        name="WhatsApp",
        manufacturer="WhatsApp add-on",
        model="Baileys",
        entry_type=DeviceEntryType.SERVICE,
    )
    if (addon_device := _find_addon_device(hass)) is not None:
        if "via_device_id" in DeviceInfo.__annotations__:  # HA 2026.8+
            info["via_device_id"] = addon_device.id
        else:
            info["via_device"] = ADDON_IDENTIFIER
    return info


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    whatsapp = hass.data[DOMAIN]
    _migrate_device(hass, entry)
    device_info = _device_info(hass)
    sensors: dict[str, WhatsappStatusSensor] = {}

    @callback
    def update(client_id: str, data: dict) -> None:
        """Update the sensor of a client, creating it on first sight."""
        sensor = sensors.get(client_id)
        if sensor is None:
            sensor = sensors[client_id] = WhatsappStatusSensor(client_id, device_info)
            sensor.set_status(data)
            async_add_entities([sensor])
        else:
            sensor.set_status(data)
            sensor.async_write_ha_state()

    @callback
    def handle_event(event: Event) -> None:
        client_id = event.data.get("clientId")
        if client_id:
            update(client_id, event.data)

    async def poll(_now=None) -> None:
        """Fetch the status from the add-on (after a restart or missed event)."""
        try:
            status = await hass.async_add_executor_job(whatsapp.get_status)
        except WhatsappAddonError as err:
            # Add-on not running: mark every known client as stopped
            for client_id, sensor in sensors.items():
                if sensor.native_value != "stopped":
                    update(
                        client_id,
                        {
                            "state": "stopped",
                            "since": dt_util.utcnow().isoformat(),
                            "last_error": str(err),
                        },
                    )
            return

        for client_id, data in status.items():
            update(client_id, data)

    entry.async_on_unload(hass.bus.async_listen(EVENT_STATUS_UPDATE, handle_event))
    entry.async_on_unload(async_track_time_interval(hass, poll, POLL_INTERVAL))
    await poll()


class WhatsappStatusSensor(SensorEntity):
    """Connection status of one WhatsApp client."""

    _attr_should_poll = False
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = STATES

    def __init__(self, client_id: str, device_info: DeviceInfo) -> None:
        self._client_id = client_id
        self._attr_unique_id = f"whatsapp_{slugify(client_id)}_status"
        # Device "WhatsApp" + "<client> status" gives the friendly name
        # "WhatsApp default status" and entity ID sensor.whatsapp_<client>_status
        self._attr_has_entity_name = True
        self._attr_name = f"{client_id} status"
        self._attr_device_info = device_info
        self._attr_extra_state_attributes = {"client_id": client_id}

    def set_status(self, data: dict) -> None:
        state = data.get("state")
        self._attr_native_value = state if state in STATES else None
        self._attr_icon = (
            "mdi:whatsapp" if state == "connected" else "mdi:alert-circle"
        )
        attributes = {"client_id": self._client_id}
        for key in ATTRIBUTES:
            if key in data:
                attributes[key] = data[key]
            elif key in self._attr_extra_state_attributes:
                attributes[key] = self._attr_extra_state_attributes[key]
        self._attr_extra_state_attributes = attributes
