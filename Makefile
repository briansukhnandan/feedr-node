.PHONY: build init start stop logs test

COMPOSE = FEEDR_UID=$$(id -u) FEEDR_GID=$$(id -g) docker compose

build:
	$(COMPOSE) build --pull

init:
	mkdir -p config scripts
	$(COMPOSE) run --rm feedr-node init

start:
	$(COMPOSE) build --pull
	$(COMPOSE) up --force-recreate --detach

stop:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow feedr-node

test:
	docker build --pull --target test -t feedr-node:test .
