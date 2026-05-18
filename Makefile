.PHONY: dev build up down restart logs clean

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
