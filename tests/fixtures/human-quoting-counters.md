Acted on all four findings. Every one was real, and the first was demonstrated on this very PR.

**1. Free-text verdict matching.** `grep -qF 'no issues found'` tested the whole comment body. Qodo quotes findings and diff hunks verbatim, so that phrase appears inside reviews that are *not* clean — including the review above, which contains it while reporting `Bugs (4)`. The gate would have merged the PR that broke it. Now only the structured `<code>` counter chips are parsed; every counter must be `0`, and the Bugs chip must be present so an unrecognised comment shape can't pass by having no counters at all.

**2. No binding to the reviewed revision.** This was live, not theoretical: Qodo reviewed `eccd352` while the head had already moved to `947095f`. The reviewed SHA now comes from the commit marker Qodo footers in the comment, must equal `headRefOid`, and the merge passes `--match-head-commit` so a push racing the comparison is rejected by GitHub rather than slipping in. No marker means no verifiable revision identity, so it fails closed.

**3. Read failures counted as clean.** Both queries ended in `|| echo 0`, so an outage or auth error became "nothing failed, nothing pending" and merged without confirming the build ran. Check state is now read per-commit via the API, a read failure exits non-zero, and the `build` check must be present *and* successful rather than merely not failing.

**4. Unreachable pending branch.** Correct on the exit code: `gh pr checks` exits 8 while pending, so `|| echo 0` appended a second zero, making the count `0\n0` — not equal to `0` — so pending checks took the failure exit and the branch meant to handle them never ran. Replaced with a bounded poll against the check-runs API, whose transport status is independent of check conclusions.

Parser verified against the real comments on this repo:

| Case | Result |
| --- | --- |
| This review (4 bugs, prose contains "no issues found") | not clean |
| #13 review (0/0/0) | clean |
| "Qodo is busy working" | not clean |
| Clean counters, no commit marker | not clean |

On the suggested alternative of publishing a required status: agreed it's the better shape, and worth doing if this outlives the hackathon. It needs branch protection plus a status-publishing step, which is more moving parts than a one-day repo warrants — the trade recorded here rather than left implicit.
