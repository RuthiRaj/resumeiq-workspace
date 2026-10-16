"""Schemas for B0 endpoints."""

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(examples=["ok"])
    version: str = Field(examples=["0.1.0"])
    environment: str = Field(examples=["development"])


class MeResponse(BaseModel):
    """Authenticated caller identity. PII-minimal: only what the token asserts."""

    id: str = Field(examples=["123e4567-e89b-12d3-a456-426614174000"])
    email: str | None = Field(default=None, examples=["user@example.com"])
    role: str | None = Field(default=None, examples=["authenticated"])


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail
