"""Supabase JWT verification dependency.

Verified against the current Supabase docs (fetched 2026-10-16;
``https://supabase.com/docs/guides/auth/jwts`` and
``https://supabase.com/docs/guides/auth/signing-keys``):

* New signing-keys system: asymmetric keys (ES256/RS256). The project exposes
  its public keys at ``GET {SUPABASE_URL}/auth/v1/.well-known/jwks.json``.
  Verify by matching the JWT header ``kid``/``alg`` against that JWKS.
  The endpoint is edge-cached for 10 minutes, so clients must not cache keys
  longer (we rely on ``PyJWKClient``'s built-in short-lived cache).
* Legacy system: a single HS256 shared secret ("JWT secret"). The docs
  recommend verifying via the Auth server (``GET /auth/v1/user``) or migrating
  to asymmetric keys, and warn against local HS256 verification. We keep a
  local-HS256 fallback ONLY for backwards compatibility during migration,
  enabled only when ``SUPABASE_JWT_SECRET`` is set.

Claim checks: ``exp`` enforced (30s leeway for clock skew), ``aud`` must equal
``SUPABASE_JWT_AUDIENCE`` (Supabase issues ``authenticated``), ``iss`` checked
only when an expected issuer is configured, and ``sub`` is required.
"""

from dataclasses import dataclass, field
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWKClient
from jwt.types import Options

from app.core.config import Settings
from app.core.logging import get_logger
from app.repositories.workspace import SupabaseWorkspaceRepository, WorkspaceRepository
from app.services.workspace_service import WorkspaceService

logger = get_logger(__name__)

_LEEWAY_SECONDS = 30
_jwks_clients: dict[str, PyJWKClient] = {}


@dataclass
class UserClaims:
    sub: str
    email: str | None = None
    role: str | None = None
    exp: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def _unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": code, "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


def _misconfigured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "auth_not_configured", "message": "Server auth is not configured."},
    )


def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    client = _jwks_clients.get(jwks_url)
    if client is None:
        client = PyJWKClient(jwks_url)
        _jwks_clients[jwks_url] = client
    return client


def _decode_options() -> Options:
    return {"require": ["exp", "sub"]}


def verify_supabase_jwt(token: str, settings: Settings) -> UserClaims:
    """Verify a Supabase access token, returning the caller's claims."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise _unauthorized("malformed_token", "Token is malformed.") from None

    alg = str(header.get("alg", ""))
    issuer: str | None = settings.jwt_issuer or None

    try:
        if alg == "HS256":
            # Legacy shared-secret path (migration fallback only).
            if not settings.supabase_jwt_secret:
                raise _unauthorized(
                    "legacy_secret_not_configured",
                    "Legacy HS256 token presented but no shared secret is configured.",
                )
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience=settings.supabase_jwt_audience,
                issuer=issuer,
                leeway=_LEEWAY_SECONDS,
                options=_decode_options(),
            )
        else:
            if not settings.jwks_url:
                raise _misconfigured()
            signing_key = _get_jwks_client(settings.jwks_url).get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg] if alg else ["ES256", "RS256"],
                audience=settings.supabase_jwt_audience,
                issuer=issuer,
                leeway=_LEEWAY_SECONDS,
                options=_decode_options(),
            )
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token_expired", "Token has expired.") from None
    except jwt.InvalidAudienceError:
        raise _unauthorized("invalid_audience", "Token audience is invalid.") from None
    except jwt.InvalidIssuerError:
        raise _unauthorized("invalid_issuer", "Token issuer is invalid.") from None
    except jwt.InvalidSignatureError:
        raise _unauthorized("invalid_signature", "Token signature is invalid.") from None
    except jwt.MissingRequiredClaimError as exc:
        raise _unauthorized("missing_claim", f"Token is missing claim: {exc.claim}.") from None
    except (jwt.DecodeError, jwt.InvalidTokenError):
        raise _unauthorized("malformed_token", "Token is malformed.") from None
    except Exception as exc:  # e.g. PyJWKClientError: unknown kid / JWKS fetch failure
        logger.info("auth_failed", extra={"code": type(exc).__name__})
        raise _unauthorized("invalid_token", "Token could not be verified.") from None

    sub = payload.get("sub")
    if not sub:
        raise _unauthorized("missing_claim", "Token is missing claim: sub.")
    return UserClaims(
        sub=str(sub),
        email=payload.get("email"),
        role=payload.get("role"),
        exp=payload.get("exp"),
        raw={k: v for k, v in payload.items() if k in ("aud", "iss", "role", "aal", "amr")},
    )


def get_current_user(request: Request) -> UserClaims:
    """FastAPI dependency: require a valid Supabase JWT on `Authorization: Bearer`.

    Settings come from `app.state` so tests (and future lifespan overrides)
    control configuration per application instance.
    """
    settings: Settings = request.app.state.settings
    if not settings.auth_configured:
        raise _misconfigured()
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("missing_credentials", "Missing bearer token.")
    return verify_supabase_jwt(token.strip(), settings)


def get_bearer_token(request: Request) -> str:
    """Raw bearer token, forwarded to the Data API so Postgres sees the caller."""
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("missing_credentials", "Missing bearer token.")
    return token.strip()


def get_workspace_repository(request: Request) -> WorkspaceRepository:
    """A workspace repository bound to the caller's JWT (RLS enforced in Postgres).

    Tests override this dependency with the in-memory repository. The token is
    validated separately by ``get_current_user``; here we only forward it.
    """
    settings: Settings = request.app.state.settings
    if not settings.data_api_configured:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "data_api_not_configured",
                "message": "Server data access is not configured.",
            },
        )
    return SupabaseWorkspaceRepository(
        settings.rest_url,
        settings.supabase_publishable_key,
        get_bearer_token(request),
    )


def get_workspace_service(
    repository: Annotated[WorkspaceRepository, Depends(get_workspace_repository)],
) -> WorkspaceService:
    """FastAPI dependency: the workspace service over the request's repository."""
    return WorkspaceService(repository)
