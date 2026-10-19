"""AI routes.

Endpoints:
- POST /ai/suggest       — proactive cleaning plan based on the detect result
- POST /ai/chat          — follow-up questions about the dataset
- POST /ai/analyze       — plain-language interpretation of explore/detect findings
- POST /ai/analyze/chat  — follow-up chat anchored to analysis context
"""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.ai import (
    AIChatRequest,
    AIChatResponse,
    AISuggestRequest,
    AISuggestResponse,
    AIAnalyzeRequest,
    AIAnalyzeResponse,
    AIAnalyzeChatRequest,
)
from app.services.ai_service import (
    get_chat_reply,
    get_suggestion,
    get_analysis_insight,
    get_analysis_chat_reply,
)
from app.services.auth_service import get_user_by_token

router = APIRouter(prefix="/ai", tags=["ai"])


def _require_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return authorization.removeprefix("Bearer ").strip()


@router.post("/suggest", response_model=AISuggestResponse)
async def ai_suggest(
    payload: AISuggestRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return a prioritized AI cleaning plan for the given dataset context."""
    await get_user_by_token(db, _require_token(authorization))
    try:
        suggestion = await get_suggestion(payload.context)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return AISuggestResponse(suggestion=suggestion)


@router.post("/chat", response_model=AIChatResponse)
async def ai_chat(
    payload: AIChatRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Answer a follow-up question about the dataset using its quality context."""
    await get_user_by_token(db, _require_token(authorization))
    try:
        reply = await get_chat_reply(payload.context, payload.message, payload.history)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return AIChatResponse(reply=reply)


@router.post("/analyze", response_model=AIAnalyzeResponse)
async def ai_analyze(
    payload: AIAnalyzeRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return a plain-language interpretation of explore/detect findings."""
    await get_user_by_token(db, _require_token(authorization))
    try:
        insight = await get_analysis_insight(payload.context)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return AIAnalyzeResponse(insight=insight)


@router.post("/analyze/chat", response_model=AIChatResponse)
async def ai_analyze_chat(
    payload: AIAnalyzeChatRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Follow-up chat anchored to the analysis/detect context."""
    await get_user_by_token(db, _require_token(authorization))
    try:
        reply = await get_analysis_chat_reply(payload.context, payload.message, payload.history)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return AIChatResponse(reply=reply)
