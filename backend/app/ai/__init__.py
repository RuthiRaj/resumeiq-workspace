"""AI gateway (B3). No module-level provider clients, keys or network calls."""

from app.ai.claims import ClaimValidator, ValidationReport
from app.ai.consent import ConsentGrant, ConsentStore, InMemoryConsentStore, SupabaseConsentStore
from app.ai.errors import (
    AIConsentRequiredError,
    AIError,
    AIGroundingError,
    AINotConfiguredError,
    AIProviderAuthError,
    AIProviderError,
    AIQuotaExceededError,
    AIRateLimitedError,
    AISchemaError,
    AITimeoutError,
    AIUnavailableError,
    ClaimViolation,
)
from app.ai.gateway import AICallResult, AIGateway, GroundingPolicy
from app.ai.privacy import RedactionSession, redact_text
from app.ai.providers import build_provider_chain, missing_provider_keys
from app.ai.quota import InMemoryDailyQuota, QuotaState, QuotaStore
from app.ai.schemas import (
    BulletRewriteResult,
    Claim,
    EvidenceItem,
    ExplainGapInput,
    ExtractResumeFieldsInput,
    FieldClaim,
    GapExplanationResult,
    JobRequirementsResult,
    ParseJobRequirementsInput,
    RequirementClaim,
    ResumeFieldsResult,
    RewriteBulletInput,
)
from app.ai.tasks import TASKS, TaskSpec, get_task, strict_json_schema

__all__ = [
    "TASKS",
    "AICallResult",
    "AIConsentRequiredError",
    "AIError",
    "AIGateway",
    "AIGroundingError",
    "AINotConfiguredError",
    "AIProviderAuthError",
    "AIProviderError",
    "AIQuotaExceededError",
    "AIRateLimitedError",
    "AISchemaError",
    "AITimeoutError",
    "AIUnavailableError",
    "BulletRewriteResult",
    "Claim",
    "ClaimValidator",
    "ClaimViolation",
    "ConsentGrant",
    "ConsentStore",
    "EvidenceItem",
    "ExplainGapInput",
    "ExtractResumeFieldsInput",
    "FieldClaim",
    "GapExplanationResult",
    "GroundingPolicy",
    "InMemoryConsentStore",
    "InMemoryDailyQuota",
    "JobRequirementsResult",
    "ParseJobRequirementsInput",
    "QuotaState",
    "QuotaStore",
    "RedactionSession",
    "RequirementClaim",
    "ResumeFieldsResult",
    "RewriteBulletInput",
    "SupabaseConsentStore",
    "TaskSpec",
    "ValidationReport",
    "build_provider_chain",
    "get_task",
    "missing_provider_keys",
    "redact_text",
    "strict_json_schema",
]
