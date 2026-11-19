# Changelog

## 1.0.3
- Site policy (`~/.claude-in-safari/policy.json`): `blocked`, `confirm`, `confirmAll`; tabs of blocked sites are hidden in `safari_tabs`; fail closed on a broken policy file.
- New extension method `tab_info` (the policy needs the extension 1.0.3).
- `claude-safari-server --policy` shows the policy file and its state.
- Pages without a host are matched by scheme (`file:`, `favorites:`, `about:`); `"*"` covers them. Tabs whose address Safari hides (site set to Deny) are refused while a policy is active.
- `tools/policy_test.py`: 39 automated checks without Safari.
- New app icon; refreshed install screenshots.

## 0.2.0
- Origin + token protection of the local WebSocket, signing wizard, full install manual.
