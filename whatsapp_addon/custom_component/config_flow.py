"""Config flow for the WhatsApp integration."""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN
from .whatsapp import Whatsapp, WhatsappAddonError

TITLE = "WhatsApp"


class WhatsappConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add the WhatsApp integration (one entry for the add-on)."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                # Not hass.data: on a fresh install the integration is not
                # set up yet while this flow runs
                await self.hass.async_add_executor_job(Whatsapp().get_status)
            except WhatsappAddonError:
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(title=TITLE, data={})

        return self.async_show_form(step_id="user", errors=errors)

    async def async_step_import(self, import_data: dict[str, Any]) -> ConfigFlowResult:
        """Import `whatsapp:` from configuration.yaml.

        No connection check: during startup the add-on may not be ready yet.
        """
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=TITLE, data={})
