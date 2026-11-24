# One command per check. Nothing else is needed to work on this repo.
.PHONY: setup test lint format typecheck build run check clean

setup: ## Create .venv, install the project and its dev tools.
	uv sync

test: ## Run the test suite.
	uv run pytest

lint: ## Check style and common mistakes.
	uv run ruff check .

format: ## Rewrite files with ruff's formatter.
	uv run ruff format .

typecheck: ## Static types for src and tests.
	uv run mypy

build: ## Build sdist and wheel into dist/.
	uv build

run: ## Run the CLI from the venv.
	uv run readlist --help

check: lint typecheck test ## Everything a CI run should run.

clean: ## Remove build output, caches and the venv.
	rm -rf dist .pytest_cache .ruff_cache .mypy_cache .venv
