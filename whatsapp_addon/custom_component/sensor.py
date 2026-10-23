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


def _device_info(hass: HomeAssistant) -> DeviceInfo:
    """Attach to the add-on's Supervisor device, or create our own device."""
    addon_identifier = (HASSIO_DOMAIN, ADDON_SLUG)
    if dr.async_get(hass).async_get_device(identifiers={addon_identifier}):
        return DeviceInfo(identifiers={addon_identifier})

    # No Supervisor device (e.g. Supervisor integration not loaded)
    return DeviceInfo(
        identifiers={(DOMAIN, ADDON_SLUG)},
        name="Whatsapp",
        manufacturer="WhatsApp add-on",
        entry_type=DeviceEntryType.SERVICE,
    )


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    whatsapp = hass.data[DOMAIN]
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
        # Full name (not has_entity_name), so the entity ID stays
        # sensor.whatsapp_<client>_status
        self._attr_name = f"WhatsApp {client_id} status"
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
