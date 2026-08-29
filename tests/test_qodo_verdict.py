"""Fixtures are real comments from this repository, not invented ones.

Each case here is a way an earlier version of the gate could be fooled, or was.

Run with `python3 tests/test_qodo_verdict.py`. Deliberately no pytest: this repo
tests with bun, and a single pure function does not justify adding a Python test
dependency to CI.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / ".github" / "scripts"))

from qodo_verdict import parse  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def load(name: str) -> str:
    return (FIXTURES / name).read_text()


def test_findings_are_not_clean_even_when_the_prose_says_otherwise():
    # This is the case that broke the first version. Qodo quotes findings
    # verbatim, so its review of the parser contains the literal words the
    # parser was matching on, while reporting four bugs.
    body = load("qodo-four-bugs.html")
    assert "no issues found" in body, "fixture no longer exercises the trap"
    clean, _, counters = parse(body)
    assert clean is False
    assert counters[0] != "0"


def test_a_human_quoting_counter_text_is_not_a_verdict():
    # This fixture exists because capturing the one above with a naive filter
    # grabbed a human reply that quoted "Bugs (4)" in prose. Free text that
    # mentions counters is not a verdict, and the chips are markup a comment
    # body cannot accidentally contain.
    clean, _, counters = parse(load("human-quoting-counters.md"))
    assert clean is False
    assert counters == []


def test_all_zero_counters_are_clean():
    clean, sha, counters = parse(load("qodo-clean.html"))
    assert clean is True
    assert set(counters) == {"0"}
    assert len(sha) == 40


def test_placeholder_is_not_a_verdict():
    # Qodo posts this first and edits the verdict in later. It has no counters,
    # so it must not be read as an all-clear.
    clean, sha, counters = parse(load("qodo-placeholder.html"))
    assert clean is False
    assert counters == []
    assert sha == ""


def test_summary_comment_is_not_a_verdict():
    # The PR summary describes the change and carries no counters.
    clean, _, _ = parse(load("qodo-summary.html"))
    assert clean is False


def test_clean_counters_without_a_commit_marker_are_not_clean():
    # No commit marker means no verifiable revision, so there is nothing to
    # bind the verdict to and the merge must not proceed.
    body = (
        "<code>\U0001f41e Bugs (0)</code> <code>Rule violations (0)</code> "
        "<h3>Great, no issues found!</h3>"
    )
    clean, sha, _ = parse(body)
    assert clean is False
    assert sha == ""


def test_a_missing_bugs_chip_is_not_clean():
    # Guards against an unrecognised comment shape passing by having no
    # counters at all, or only counters this does not know about.
    body = "<code>Rule violations (0)</code> /commit/" + "a" * 40
    clean, _, _ = parse(body)
    assert clean is False


def test_nonzero_in_any_counter_is_not_clean():
    body = (
        "<code>\U0001f41e Bugs (0)</code> <code>Rule violations (1)</code> "
        "/commit/" + "b" * 40
    )
    clean, _, _ = parse(body)
    assert clean is False


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = []
    for fn in tests:
        try:
            fn()
            print(f"  pass  {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures.append((fn.__name__, exc))
            print(f"  FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(tests) - len(failures)} passed, {len(failures)} failed")
    raise SystemExit(1 if failures else 0)
