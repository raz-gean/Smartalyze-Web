from __future__ import annotations

"""AI suggestion service.

Supports Ollama (local, default) and Groq / Gemini (cloud) via the AI_PROVIDER env var.
The LLM never sees raw dataset rows — only the compact summary already computed by the
cleaning detection pipeline, keeping token usage tiny (~600-800 tokens per request).

Provider config (set in .env):
    AI_PROVIDER=ollama          # default
    OLLAMA_BASE_URL=http://localhost:11434
    OLLAMA_MODEL=llama3.2:3b

    AI_PROVIDER=groq
    GROQ_API_KEY=gsk_...
    GROQ_MODEL=openai/gpt-oss-120b      # Groq retired the Llama 3.3 models

    AI_PROVIDER=gemini
    GEMINI_API_KEY=...
    GEMINI_MODEL=gemini-1.5-flash
"""

import os
import httpx

from app.schemas.ai import AIContext, AIChatMessage, AIAnalyzeContext

_PROVIDER = os.getenv("AI_PROVIDER", "ollama").lower()
_OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
_GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
_GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

_SYSTEM_PROMPT = (
    "You are a data analysis assistant for Smartalyze, a data cleaning and analysis tool. "
    "Help non-technical users understand their dataset issues and guide them through cleaning. "
    "Be concise (under 200 words). Use numbered steps when giving a cleaning plan. "
    "Speak plainly — explain any technical term you use. "
    "Give direct, actionable advice. Do not ask follow-up questions."
)


def _build_context_text(ctx: AIContext) -> str:
    lines: list[str] = [f'Dataset: "{ctx.dataset_name}"']

    if ctx.column_types:
        cols = ", ".join(f"{c} ({t})" for c, t in ctx.column_types.items())
        lines.append(f"Columns: {cols}")

    missing = {k: v for k, v in ctx.missing_values.items() if v > 0}
    if missing:
        lines.append("Missing values: " + ", ".join(f"{c}: {n}" for c, n in missing.items()))
    else:
        lines.append("Missing values: none")

    lines.append(f"Duplicate rows: {ctx.duplicates}")

    if ctx.issues:
        lines.append("Issues detected:")
        for issue in ctx.issues[:8]:
            sev = issue.get("severity", "info")
            msg = issue.get("message", "")
            lines.append(f"  [{sev}] {msg}")

    for p in ctx.pattern_suggestions[:3]:
        conf = p.get("weighted_confidence", 0)
        lines.append(
            f"Smart fill available: {p.get('target_column')} using "
            f"{p.get('key_column')} ({conf:.0%} confidence)"
        )

    for o in ctx.outliers[:3]:
        lines.append(
            f"Outliers in {o.get('column')}: {o.get('outlier_count')} values "
            f"outside [{o.get('lower_fence')}, {o.get('upper_fence')}]"
        )

    return "\n".join(lines)


async def _ollama_chat(messages: list[dict]) -> str:
    # connect timeout: fail fast if Ollama isn't running
    # read timeout: None — CPU inference can take 60-120 s, frontend enforces the wall clock limit
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)) as client:
        try:
            resp = await client.post(
                f"{_OLLAMA_URL}/api/chat",
                json={"model": _OLLAMA_MODEL, "messages": messages, "stream": False},
            )
            resp.raise_for_status()
            return str(resp.json()["message"]["content"])
        except httpx.ConnectError:
            raise RuntimeError(
                "Could not connect to Ollama. Make sure it is running "
                f"at {_OLLAMA_URL} and the model '{_OLLAMA_MODEL}' is pulled."
            )


async def _openai_compatible_chat(base_url: str, api_key: str, model: str, messages: list[dict]) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json={"model": model, "messages": messages, "max_tokens": 512},
        )
        resp.raise_for_status()
        return str(resp.json()["choices"][0]["message"]["content"])


async def _chat(messages: list[dict]) -> str:
    if _PROVIDER == "ollama":
        return await _ollama_chat(messages)
    elif _PROVIDER == "groq":
        return await _openai_compatible_chat(
            "https://api.groq.com/openai/v1", _GROQ_API_KEY, _GROQ_MODEL, messages
        )
    elif _PROVIDER == "gemini":
        return await _openai_compatible_chat(
            "https://generativelanguage.googleapis.com/v1beta/openai",
            _GEMINI_API_KEY,
            _GEMINI_MODEL,
            messages,
        )
    raise ValueError(f"Unknown AI_PROVIDER: '{_PROVIDER}'. Use 'ollama', 'groq', or 'gemini'.")


async def get_suggestion(ctx: AIContext) -> str:
    context_text = _build_context_text(ctx)
    user_prompt = (
        f"{context_text}\n\n"
        "Give me a prioritized cleaning plan with 3-5 numbered steps. "
        "For each step: what to fix, why it matters, and what operation to use. "
        "Then suggest 2 analyses worth running after cleaning."
    )
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    return await _chat(messages)


async def get_chat_reply(ctx: AIContext, message: str, history: list[AIChatMessage]) -> str:
    context_text = _build_context_text(ctx)
    system_with_context = (
        f"{_SYSTEM_PROMPT}\n\n"
        f"Here is the current dataset context:\n{context_text}"
    )
    messages: list[dict] = [{"role": "system", "content": system_with_context}]
    for h in history[-10:]:
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": message})
    return await _chat(messages)


_ANALYZE_SYSTEM_PROMPT = (
    "You are a data insight assistant for Smartalyze. "
    "Interpret analysis results for non-technical users in plain English — "
    "explain what the numbers mean, not how to clean the data. "
    "Highlight 2-3 of the most interesting findings: notable correlations, "
    "suspicious outlier rates, strong or weak trends, or columns worth investigating. "
    "Be concise (under 200 words). Define any statistical term you use in one phrase. "
    "Do not suggest cleaning steps. Do not ask follow-up questions."
)


def _build_analyze_context_text(ctx: AIAnalyzeContext) -> str:
    lines: list[str] = [
        f'Dataset: "{ctx.dataset_name}" — {ctx.row_count} rows, {ctx.col_count} columns'
    ]
    if ctx.column_stats:
        lines.append("Column statistics:")
        for c in ctx.column_stats[:10]:
            parts = [f"  {c.name} ({c.dtype})", f"missing={c.missing_pct:.1f}%"]
            if c.mean is not None:
                parts.append(f"mean={c.mean:.2f}")
            if c.min is not None and c.max is not None:
                parts.append(f"range=[{c.min:.2f}, {c.max:.2f}]")
            lines.append(" ".join(parts))
    if ctx.trends:
        lines.append("Trend analysis:")
        for t in ctx.trends[:5]:
            lines.append(
                f"  {t.column}: {t.direction} (slope={t.slope:.4f}, R²={t.r_squared:.2f})"
            )
    if ctx.anomalies:
        lines.append("Anomaly detection:")
        for a in ctx.anomalies[:5]:
            lines.append(
                f"  {a.column}: {a.outlier_count} outliers ({a.outlier_pct:.1f}%), "
                f"fence=[{a.lower_fence:.2f}, {a.upper_fence:.2f}]"
            )
    if ctx.top_correlations:
        lines.append("Top correlations:")
        for p in ctx.top_correlations[:5]:
            direction = "positive" if p.r >= 0 else "negative"
            lines.append(f"  {p.col_a} vs {p.col_b}: r={p.r:.2f} ({direction})")
    return "\n".join(lines)


async def get_analysis_insight(ctx: AIAnalyzeContext) -> str:
    context_text = _build_analyze_context_text(ctx)
    messages = [
        {"role": "system", "content": _ANALYZE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"{context_text}\n\n"
                "Summarize the most interesting findings. "
                "Focus on what a business user should know about this data."
            ),
        },
    ]
    return await _chat(messages)


async def get_analysis_chat_reply(
    ctx: AIAnalyzeContext, message: str, history: list[AIChatMessage]
) -> str:
    context_text = _build_analyze_context_text(ctx)
    system = f"{_ANALYZE_SYSTEM_PROMPT}\n\nAnalysis context:\n{context_text}"
    messages: list[dict] = [{"role": "system", "content": system}]
    for h in history[-10:]:
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": message})
    return await _chat(messages)
