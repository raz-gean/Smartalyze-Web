"""Verification tests for the AI layer's prompts and response handling (no network calls).

Runnable two ways:
- with pytest (if installed):   pytest tests/test_ai_service.py
- standalone (no deps):         python -m tests.test_ai_service   (from the backend/ dir)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.ai import AIAnalyzeContext, AIContext
from app.services.ai_service import (
    _ANALYZE_SYSTEM_PROMPT,
    _SYSTEM_PROMPT,
    _build_analyze_context_text,
    _build_chat_payload,
    _build_context_text,
    _clean_answer,
    _trim_to_last_sentence,
)


def test_cut_off_answer_is_trimmed_to_last_sentence():
    text = "Remove the duplicate rows first. Then use Smart fill on Zip Code. Finally check the outlier, which could affect"
    assert _trim_to_last_sentence(text) == "Remove the duplicate rows first. Then use Smart fill on Zip Code."


def test_complete_answer_is_unchanged():
    text = "Remove the duplicate rows first. Then use Smart fill."
    assert _trim_to_last_sentence(text) == text


def test_answer_without_a_sentence_end_gets_an_ellipsis():
    assert _trim_to_last_sentence("Remove the duplicate rows and then") == "Remove the duplicate rows and then…"


def test_cleaning_context_includes_row_count():
    text = _build_context_text(AIContext(dataset_name="sales.csv", row_count=120))
    assert "120 rows" in text.splitlines()[0]


def test_cleaning_context_without_row_count_still_works():
    assert _build_context_text(AIContext(dataset_name="sales.csv")).splitlines()[0] == 'Dataset: "sales.csv"'


def test_prompts_name_the_real_actions_and_accuracy_rules():
    for prompt in (_SYSTEM_PROMPT, _ANALYZE_SYSTEM_PROMPT):
        for phrase in ("Smart fill", "Remove duplicate rows", "Fix inconsistent values", "Potential outliers"):
            assert phrase in prompt, phrase
        assert "Q1 - 1.5 x IQR" in prompt
        assert "currency" in prompt
        assert "Never invent" in prompt


def test_analysis_context_marks_sections_this_view_does_not_cover():
    explore = AIAnalyzeContext(
        dataset_name="sales.csv", row_count=10, col_count=3,
        trends=[{"column": "Sales", "direction": "increasing", "slope": 1.0, "r_squared": 0.8}],
    )
    text = _build_analyze_context_text(explore)
    assert "Not included in this view: column statistics, outliers, correlations" in text
    assert "Do not say whether there are any" in text


def test_analysis_context_lists_suggested_groupings():
    explore = AIAnalyzeContext(
        dataset_name="sales.csv", row_count=10, col_count=3,
        suggested_groupings=["Average Sales by Region: Region explains about 62% of the differences in Sales."],
    )
    text = _build_analyze_context_text(explore)
    assert "Suggested groupings" in text and "Average Sales by Region" in text
    assert "Suggested for your data" in _ANALYZE_SYSTEM_PROMPT


def test_trends_are_described_as_row_order_and_fills_match_the_app():
    explore = AIAnalyzeContext(
        dataset_name="sales.csv", row_count=10, col_count=3,
        trends=[{"column": "Sales", "direction": "increasing", "slope": 1.0, "r_squared": 0.8}],
    )
    text = _build_analyze_context_text(explore)
    assert "from the first row to the last" in text and "change per row" in text
    assert "median for number columns" in _SYSTEM_PROMPT


def test_invented_dollar_signs_are_removed():
    assert _clean_answer("Average sales are $242, ranging from $ 120 to $950.") == "Average sales are 242, ranging from 120 to 950."
    assert _clean_answer("Use the $ symbol only in text.") == "Use the $ symbol only in text."


def test_reasoning_effort_only_for_gpt_oss_models():
    msgs = [{"role": "user", "content": "hi"}]
    oss = _build_chat_payload("openai/gpt-oss-120b", msgs)
    assert oss["reasoning_effort"] == "low" and oss["max_tokens"] >= 1000
    assert "reasoning_effort" not in _build_chat_payload("qwen/qwen3.8-27b", msgs)


def _run_all():
    tests = [fn for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    passed = 0
    for fn in tests:
        try:
            fn()
        except AssertionError as exc:
            print(f"FAIL  {fn.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR {fn.__name__}: {type(exc).__name__}: {exc}")
        else:
            passed += 1
            print(f"PASS  {fn.__name__}")
    print(f"\n{passed}/{len(tests)} passed")
    return passed == len(tests)


if __name__ == "__main__":
    sys.exit(0 if _run_all() else 1)
