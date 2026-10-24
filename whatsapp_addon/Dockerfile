ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm

COPY . /
RUN chmod a+x /run.sh
RUN chmod a+x /finish.sh

RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund && npm cache clean --force

EXPOSE 3000
CMD [ "/run.sh" ]