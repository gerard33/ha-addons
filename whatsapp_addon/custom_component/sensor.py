"""Connection status sensor per WhatsApp client."""
from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.typing import ConfigType, DiscoveryInfoType
from homeassistant.util import dt as dt_util, slugify

from .whatsapp import WhatsappAddonError

DOMAIN = "whatsapp"
EVENT_STATUS_UPDATE = "whatsapp_status_update"
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


async def async_setup_platform(
    hass: HomeAssistant,
    config: ConfigType,
    async_add_entities: AddEntitiesCallback,
    discovery_info: DiscoveryInfoType | None = None,
) -> None:
    whatsapp = hass.data[DOMAIN]
    sensors: dict[str, WhatsappStatusSensor] = {}

    @callback
    def update(client_id: str, data: dict) -> None:
        """Update the sensor of a client, creating it on first sight."""
        sensor = sensors.get(client_id)
        if sensor is None:
            sensor = sensors[client_id] = WhatsappStatusSensor(client_id)
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

    hass.bus.async_listen(EVENT_STATUS_UPDATE, handle_event)
    async_track_time_interval(hass, poll, POLL_INTERVAL)
    await poll()


class WhatsappStatusSensor(SensorEntity):
    """Connection status of one WhatsApp client."""

    _attr_should_poll = False
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = STATES

    def __init__(self, client_id: str) -> None:
        self._client_id = client_id
        self._attr_unique_id = f"whatsapp_{slugify(client_id)}_status"
        self._attr_name = f"WhatsApp {client_id} status"
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
