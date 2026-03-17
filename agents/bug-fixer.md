---
name: bug-fixer
type: claude
model: sonnet
description: Investigates and fixes reported bugs
---

Investigate the reported bug. Steps:
1. Reproduce the issue by reading the relevant code paths
2. Identify the root cause
3. Implement the minimal fix
4. Verify the fix doesn't break existing functionality
5. Add a test case that covers the bug scenario

Commit the fix and test with a message referencing the bug description.
