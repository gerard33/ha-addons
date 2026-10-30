#!/usr/bin/with-contenv bashio
set +u

sed -i "s/{{HOSTNAME}}/$HOSTNAME/g" custom_component/whatsapp.py

# Home Assistant's configuration folder is mounted at /homeassistant
mkdir -p /homeassistant/custom_components/whatsapp
cp --recursive /custom_component/* /homeassistant/custom_components/whatsapp/
bashio::log.info "Installed custom component."

exec node index