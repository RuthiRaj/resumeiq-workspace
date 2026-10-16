"""Versioned API router (v1). New domains mount here from B1 onwards."""

from fastapi import APIRouter

from app.api.v1.me import router as me_router

router = APIRouter()
router.include_router(me_router)
