from __future__ import annotations

import logging

from .whatsapp import Whatsapp, WhatsappAddonError

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.typing import ConfigType

DOMAIN = "whatsapp"
_LOGGER = logging.getLogger(__name__)

SERVICES = {
    "send_message": "send_message",
    "set_status": "set_status",
    "presence_subscribe": "presence_subscribe",
    "send_presence_update": "send_presence_update",
    "send_infinity_presence_update": "send_infinity_presence_update",
}


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    whatsapp = Whatsapp()

    def make_handler(service: str, method_name: str):
        method = getattr(whatsapp, method_name)

        async def handler(call: ServiceCall) -> None:
            try:
                await hass.async_add_executor_job(method, dict(call.data))
            except WhatsappAddonError as err:
                # Logged in the HA log and shown as a failed step in the
                # automation trace; use continue_on_error to fall back.
                _LOGGER.error("whatsapp.%s failed: %s", service, err)
                raise HomeAssistantError(f"WhatsApp {service} failed: {err}") from err

        return handler

    for service, method_name in SERVICES.items():
        hass.services.async_register(DOMAIN, service, make_handler(service, method_name))

    return True
