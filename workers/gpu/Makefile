.PHONY: contract lint typecheck test test-s3 check run

contract:
	uv run openapi-python-client generate --path ../../contracts/openapi/worker.openapi.yaml --config openapi-python-client.yaml --meta none --output-path src/reup_worker_contract --overwrite
	touch src/reup_worker_contract/py.typed
	uv run ruff check --fix --select I src/reup_worker_contract
	uv run ruff format src/reup_worker_contract

contract-check: contract
	git diff --exit-code -- src/reup_worker_contract

lint:
	uv run ruff check src tests
	uv run ruff format --check src tests

typecheck:
	uv run mypy

test:
	uv run pytest

test-s3:
	uv run pytest tests/test_assets_s3.py

check: lint typecheck test

run:
	uv run reup-gpu-worker
