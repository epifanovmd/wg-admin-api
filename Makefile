# Деплой по SSH. Настройки — .env.deploy (образец .env.deploy.example); секреты
# приложения — .env.production (кладёт `make env`).
#   make release  — готовый образ коммита из ghcr (TAG=<sha>; его собирает CI)
#   make deploy   — запасной путь: исходники на хост и сборка там же
# Цели image и local-* работают и без .env.deploy.
-include .env.deploy

TAG ?= latest
IMAGE ?= ghcr.io/epifanovmd/wg-admin
ENV_FILE ?= .env.production
COMPOSE_FILES ?= docker-compose.yml docker-compose.postgres.yml
# Нестабильная сеть до хоста: повтор установки соединения (не команды) и
# keepalive на долгой сборке. Переопределяется в .env.deploy.
SSH_OPTS ?= -o ConnectTimeout=15 -o ConnectionAttempts=5 -o ServerAliveInterval=30
SSH = ssh $(SSH_OPTS) $(SSH_USER)@$(SSH_HOST)
# Версия сборки — из git этой копии (на хост .git не уходит): тег или SHA.
APP_VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
APP_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null)
APP_BUILT_AT := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
BUILD_INFO = APP_VERSION=$(APP_VERSION) APP_COMMIT=$(APP_COMMIT) APP_BUILT_AT=$(APP_BUILT_AT)
COMPOSE_ENV = export IMAGE=$(IMAGE) TAG=$(TAG) $(BUILD_INFO) COMPOSE_FILE=$(subst $() ,:,$(strip $(COMPOSE_FILES))) COMPOSE_PROFILES=$(subst $() ,$(),$(COMPOSE_PROFILES))
COMPOSE = $(COMPOSE_ENV) && docker compose --env-file $(ENV_FILE)
REMOTE = cd $(SSH_PROJECT_DIR) && $(COMPOSE)
DB = --host $(SSH_USER)@$(SSH_HOST) --container $(DB_CONTAINER) --user $(DB_USER) --db $(DB_NAME)

REMOTE_TARGETS = deploy release sync compose env build pull migrate up down status logs restart db-dump db-restore

.PHONY: $(REMOTE_TARGETS) require-deploy image local-up local-down local-logs

$(REMOTE_TARGETS): require-deploy

require-deploy:
ifeq ($(wildcard .env.deploy),)
	$(error Нет .env.deploy — скопируйте .env.deploy.example и заполните)
endif

deploy: sync build migrate up
release: compose pull migrate up

sync:
	$(SSH) 'mkdir -p $(SSH_PROJECT_DIR)'
	rsync -az --delete -e "ssh $(SSH_OPTS)" --exclude-from=.deployignore ./ $(SSH_USER)@$(SSH_HOST):$(SSH_PROJECT_DIR)/

# Для release на хосте нужны только файлы compose и конфиг Caddy.
compose:
	$(SSH) 'mkdir -p $(SSH_PROJECT_DIR)/deploy'
	scp $(SSH_OPTS) $(COMPOSE_FILES) $(SSH_USER)@$(SSH_HOST):$(SSH_PROJECT_DIR)/
	scp $(SSH_OPTS) deploy/Caddyfile $(SSH_USER)@$(SSH_HOST):$(SSH_PROJECT_DIR)/deploy/

env:
	$(SSH) 'mkdir -p $(SSH_PROJECT_DIR)'
	scp $(SSH_OPTS) $(ENV_FILE) $(SSH_USER)@$(SSH_HOST):$(SSH_PROJECT_DIR)/$(ENV_FILE)

# Собирается один образ: api, worker и migrate его используют.
build:
	$(SSH) '$(REMOTE) build api'

pull:
	$(SSH) '$(REMOTE) pull'

migrate:
	$(SSH) '$(REMOTE) run --rm migrate'

up:
	$(SSH) '$(REMOTE) up -d --remove-orphans && docker image prune -f'

down:
	$(SSH) '$(REMOTE) down'

status:
	$(SSH) '$(REMOTE) ps'

logs:
	$(SSH) '$(REMOTE) logs -f --tail=200 api worker'

restart:
	$(SSH) '$(REMOTE) restart api worker'

db-dump:
	scripts/db/dump_db.sh $(DB) $(if $(DB_DUMP_FILE),--out $(DB_DUMP_FILE))

db-restore:
	scripts/db/restore_dump_db.sh $(DB) $(if $(DB_DUMP_FILE),--file $(DB_DUMP_FILE))

image:
	docker build --target app $(addprefix --build-arg ,$(BUILD_INFO)) -t $(IMAGE):$(TAG) .

# --- Локально (docker на этой машине, тот же состав стека) ---
local-up:
	$(COMPOSE) up -d --build --remove-orphans

local-down:
	$(COMPOSE) down

local-logs:
	$(COMPOSE) logs -f --tail=200 api worker
