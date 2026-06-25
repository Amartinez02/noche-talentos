.PHONY: dev up down logs db install docker-all prod-up prod-down prod-logs prod-build

install:
	npm install

dev: install
	@test -f .env || (echo "⚠  Crea un archivo .env basado en .env.example antes de correr en dev" && exit 1)
	@set -a; . ./.env; set +a; \
	DATABASE_URL=$${DATABASE_URL:-postgres://app:secret@localhost:5432/noche_talentos} \
	BASE_URL=$${BASE_URL:-http://localhost:8080} \
	node src/server.js

db:
	docker compose up -d postgres

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

docker-all:
	docker compose up --build

# Producción
prod-build:
	docker compose -f docker-compose.prod.yml build

prod-up:
	docker compose -f docker-compose.prod.yml up -d

prod-down:
	docker compose -f docker-compose.prod.yml down

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f
