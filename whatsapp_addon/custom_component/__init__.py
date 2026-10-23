"""WhatsApp integration, the Home Assistant side of the WhatsApp add-on."""
from __future__ import annotations

import logging

from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import DOMAIN as HOMEASSISTANT_DOMAIN
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .whatsapp import Whatsapp, WhatsappAddonError

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

SERVICES = [
    "send_message",
    "set_status",
    "presence_subscribe",
    "send_presence_update",
    "send_infinity_presence_update",
]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the services and import a `whatsapp:` YAML entry."""
    whatsapp = Whatsapp()
    hass.data[DOMAIN] = whatsapp

    def make_handler(service: str):
        method = getattr(whatsapp, service)

        async def handler(call: ServiceCall) -> None:
            try:
                await hass.async_add_executor_job(method, dict(call.data))
            except WhatsappAddonError as err:
                # Logged in the HA log and shown as a failed step in the
                # automation trace; use continue_on_error to fall back.
                _LOGGER.error("whatsapp.%s failed: %s", service, err)
                raise HomeAssistantError(f"WhatsApp {service} failed: {err}") from err

        return handler

    # Services are registered here (not per config entry), so they keep
    # working exactly as before, with or without the YAML entry.
    for service in SERVICES:
        hass.services.async_register(DOMAIN, service, make_handler(service))

    if DOMAIN in config:
        hass.async_create_task(
            hass.config_entries.flow.async_init(
                DOMAIN, context={"source": SOURCE_IMPORT}, data={}
            )
        )
        ir.async_create_issue(
            hass,
            HOMEASSISTANT_DOMAIN,
            f"deprecated_yaml_{DOMAIN}",
            is_fixable=False,
            issue_domain=DOMAIN,
            severity=ir.IssueSeverity.WARNING,
            translation_key="deprecated_yaml",
            translation_placeholders={"domain": DOMAIN, "integration_title": "WhatsApp"},
        )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the status sensors."""
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the status sensors."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
