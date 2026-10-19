"""Versioned API router (v1). New domains mount here from B1 onwards."""

from fastapi import APIRouter

from app.api.v1.imports import router as imports_router
from app.api.v1.me import router as me_router
from app.api.v1.resume import router as resume_router
from app.api.v1.workspace import router as workspace_router

router = APIRouter()
router.include_router(me_router)
router.include_router(workspace_router)
router.include_router(resume_router)
router.include_router(imports_router)
