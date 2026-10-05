.PHONY: build init start stop logs test FORCE

NODE_NAME ?= $(patsubst %-node,%,$(notdir $(CURDIR)))
INTEGRATION_ENV_FILES := $(sort $(wildcard config/*.env))
INTEGRATION_ENV_FLAGS := $(foreach file,$(INTEGRATION_ENV_FILES),--env-file $(file))
COMPOSE = FEEDR_UID=$$(id -u) FEEDR_GID=$$(id -g) docker compose $(INTEGRATION_ENV_FLAGS) --project-name $(NODE_NAME)

build:
	$(COMPOSE) build --pull

init:
	mkdir -p config scripts
	$(COMPOSE) run --rm node init

start:
	$(COMPOSE) build --pull
	$(COMPOSE) up --force-recreate --detach

stop:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow node

test:
	docker build --pull --target test -t $(NODE_NAME)-node:test .

build-%: FORCE
	$(MAKE) build NODE_NAME=$*

init-%: FORCE
	$(MAKE) init NODE_NAME=$*

start-%: FORCE
	$(MAKE) start NODE_NAME=$*

stop-%: FORCE
	$(MAKE) stop NODE_NAME=$*

logs-%: FORCE
	$(MAKE) logs NODE_NAME=$*

test-%: FORCE
	$(MAKE) test NODE_NAME=$*

FORCE:
