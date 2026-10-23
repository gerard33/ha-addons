import requests
from url_normalize import url_normalize

HOST = 'http://{{HOSTNAME}}:3000/'
TIMEOUT = 60


class WhatsappAddonError(Exception):
    """Raised when the add-on could not execute a request."""


class Whatsapp:
    def _post(self, path, data):
        try:
            response = requests.post(
                url_normalize(f'{HOST}/{path}'), json=data, timeout=TIMEOUT
            )
        except requests.RequestException as err:
            raise WhatsappAddonError(
                f'Whatsapp add-on is not reachable: {err}'
            ) from err

        text = response.text.strip()
        if response.status_code != 200 or text != 'OK':
            # The add-on answers "KO: <reason>" when something went wrong
            reason = text[3:].strip() if text.startswith('KO') else text
            raise WhatsappAddonError(
                reason or f'Whatsapp add-on returned HTTP {response.status_code}'
            )

        return True

    def send_message(self, data):
        return self._post('sendMessage', data)

    def set_status(self, data):
        return self._post('setStatus', data)

    def presence_subscribe(self, data):
        return self._post('presenceSubscribe', data)

    def send_presence_update(self, data):
        return self._post('sendPresenceUpdate', data)

    def send_infinity_presence_update(self, data):
        return self._post('sendInfinityPresenceUpdate', data)
