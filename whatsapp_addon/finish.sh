#!/usr/bin/with-contenv bashio

rm -rf /homeassistant/custom_components/whatsapp

if [ -z "$(ls -A /homeassistant/custom_components)" ]; then
   rm -rf /homeassistant/custom_components
fi

bashio::log.info "Uninstalled custom component."