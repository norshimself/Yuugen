.PHONY: dev build up down restart logs clean prod prod-down prod-logs prod-restart

# ---- Development ----
dev:
	docker compose up --build -d

up:
	docker compose up -d

build:
	docker compose build

down:
	docker compose down

restart:
	docker compose down
	docker compose up --build -d

logs:
	docker compose logs -f

clean:
	docker compose down -v
	rm -rf backend/node_modules frontend/node_modules
	rm -rf backend/dist

# ---- Production ----
prod:
	docker compose -f docker-compose.prod.yml up --build -d

prod-down:
	docker compose -f docker-compose.prod.yml down

prod-restart:
	docker compose -f docker-compose.prod.yml down
	docker compose -f docker-compose.prod.yml up --build -d

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f
