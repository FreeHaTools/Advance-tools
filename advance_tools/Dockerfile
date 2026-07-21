# Advance Tools add-on
# Official HA base image (Alpine + bashio + s6-overlay). There is no ":latest"
# tag for this image — always pin an Alpine version like the official example.
FROM ghcr.io/home-assistant/base:3.23

RUN apk add --no-cache python3 py3-pip py3-yaml \
    && pip3 install --no-cache-dir --break-system-packages aiohttp

COPY rootfs /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
