"""Authenticated identity endpoint (B0 auth proof)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import UserClaims, get_current_user
from app.schemas.common import ErrorResponse, MeResponse

router = APIRouter(tags=["identity"])


@router.get(
    "/me",
    response_model=MeResponse,
    summary="Current caller identity",
    responses={
        200: {"description": "Valid Supabase JWT."},
        401: {"model": ErrorResponse, "description": "Missing or invalid token."},
    },
)
def get_me(user: Annotated[UserClaims, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(id=user.sub, email=user.email, role=user.role)
