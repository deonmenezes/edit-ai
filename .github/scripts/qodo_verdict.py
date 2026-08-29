"""Read a Qodo review comment and decide whether it authorises a merge.

Kept out of the workflow so it can be tested. Every rule here exists because
something got past an earlier version of it, so the tests in
tests/test_qodo_verdict.py are the specification, not an afterthought.
"""

import re

# Qodo renders its counters as <code> chips. Everything else in the comment is
# free text that quotes findings and diff hunks verbatim, so a phrase like
# "no issues found" appears inside reviews that are not clean and cannot be
# used as a signal.
_COUNTER = re.compile(r"<code>[^<]*?\((\d+)\)</code>")
_BUGS_CHIP = re.compile(r"<code>[^<]*Bugs \(\d+\)</code>")
_COMMIT = re.compile(r"/commit/([0-9a-f]{40})")


def parse(body: str) -> tuple[bool, str, list[str]]:
    """Return (clean, reviewed_sha, counters).

    clean is True only when every counter is zero, the Bugs chip is present, and
    the comment names the commit it reviewed. Anything unrecognised is not clean:
    a comment shape this does not understand must stall a merge, never allow one.
    """
    counters = _COUNTER.findall(body)
    has_bugs = _BUGS_CHIP.search(body) is not None
    match = _COMMIT.search(body)
    sha = match.group(1) if match else ""

    clean = bool(counters) and has_bugs and all(c == "0" for c in counters) and bool(sha)
    return clean, sha, counters


if __name__ == "__main__":
    import os
    import sys

    clean, sha, counters = parse(os.environ.get("BODY", ""))
    out = [
        f"clean={'true' if clean else 'false'}",
        f"reviewed_sha={sha}",
        f"counters={','.join(counters) if counters else 'none'}",
    ]
    print("\n".join(out))
    # Also echo to stderr so the run log shows the decision without needing the
    # step output, which is written to a file.
    print(f"verdict clean={clean} sha={sha[:12]} counters={counters}", file=sys.stderr)
