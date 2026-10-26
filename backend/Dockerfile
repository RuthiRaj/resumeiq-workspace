# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_SYSTEM_PYTHON=1

WORKDIR /app

# Install uv, then locked dependencies first for layer caching.
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir "uv>=0.5" && uv sync --frozen --no-dev --no-install-project

# Then the application code.
COPY app ./app

# Non-root user.
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

# Put the virtual environment on PATH so uvicorn is directly available.
# The venv lives at /app/.venv because uv sync creates it in the working directory.
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Render sets $PORT; default to 8000 locally. `--no-server-header` keeps
# `Server: uvicorn` (framework/version hint) out of every response.
# Use shell form so ${PORT:-8000} expands at runtime.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-server-header"]
