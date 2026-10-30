# Multi-arch base image; Docker picks the right architecture (build.yaml is
# deprecated by the Supervisor)
ARG BUILD_FROM=ghcr.io/hassio-addons/base:17.1.0
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm

COPY . /
RUN chmod a+x /run.sh
RUN chmod a+x /finish.sh

RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund && npm cache clean --force

EXPOSE 3000
CMD [ "/run.sh" ]