FROM node:lts-alpine AS base

RUN apk add --no-cache jq py3-pip python3 su-exec tzdata \
    && ln -sf /usr/bin/python3 /usr/local/bin/python \
    && ln -sf /usr/bin/pip3 /usr/local/bin/pip

COPY bin/feedr /usr/local/bin/feedr
RUN chmod 0755 /usr/local/bin/feedr \
    && mkdir -p /config /feedr /scripts /var/lib/feedr-node

ENV FEEDR_CONFIG_FILE=/config/feedr-node.conf \
    FEEDR_HOME=/feedr \
    FEEDR_SCRIPT_DIR=/scripts \
    FEEDR_STATE_DIR=/var/lib/feedr-node \
    FEEDR_REGISTERED_CRON_JOB=0

FROM base AS test
WORKDIR /workspace
COPY bin ./bin
COPY scripts ./scripts
COPY tests ./tests
RUN chmod 0755 ./bin/feedr ./tests/feedr_test.sh \
    && node --version \
    && npm --version \
    && python --version \
    && python3 --version \
    && pip --version \
    && pip3 --version \
    && ./tests/feedr_test.sh

FROM base AS runtime
VOLUME ["/config", "/feedr", "/scripts"]
ENTRYPOINT ["feedr"]
CMD ["run"]
