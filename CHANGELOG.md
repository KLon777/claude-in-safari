# Changelog

## 1.1.0
- New tools: `safari_snapshot` (accessibility-style page tree with refs), `safari_reader` (main article as markdown), `safari_screenshot_element`, `safari_save_pdf` (whole page to a PDF under your home folder, never overwrites), `safari_drag` (pointer + HTML5 drag and drop), `safari_dialog` (alert/confirm/prompt: intercept, answer, list), `safari_upload_file` (put a file from the Mac into a file input or drop zone), `safari_cookies`, `safari_storage`.
- Sensitive tools (cookies, storage, file upload) always ask in a dialog, even with no policy; `allowSensitive` in `policy.json` lists sites where they go ahead. Upload refuses key/credential folders and files over 20 MB. `safari_dialog` and `safari_drag` count as acting tools for `confirm`.
- Indicator: the tab Claude is working on gets an amber frame and a "Claude is working in this tab" label (hidden in screenshots and OCR, fades after a few seconds).
- The extension asks for the `cookies` permission (Safari shows it once after the update).
- README: instruction text that keeps Claude on Safari and away from Claude in Chrome.
- `tools/policy_test.py`: 62 checks (sensitive tools, upload, PDF).
- `tools/feature_test_110.py`: live check of all new tools on a local page and, with `--real`, on Wikipedia, GitHub, example.com and the-internet.herokuapp.com.
- Reads and waits sent to a page that is being replaced (form submit, redirect) are now repeated against the new document instead of hanging until the 45 s timeout.
- Known Safari quirk: after `safari_cookies delete`, the tab that already read `document.cookie` keeps showing the cookie; a fresh tab does not.

## 1.0.3
- Site policy (`~/.claude-in-safari/policy.json`): `blocked`, `confirm`, `confirmAll`; tabs of blocked sites are hidden in `safari_tabs`; fail closed on a broken policy file.
- New extension method `tab_info` (the policy needs the extension 1.0.3).
- `claude-safari-server --policy` shows the policy file and its state.
- Pages without a host are matched by scheme (`file:`, `favorites:`, `about:`); `"*"` covers them. Tabs whose address Safari hides (site set to Deny) are refused while a policy is active.
- `tools/policy_test.py`: 39 automated checks without Safari.
- New app icon; refreshed install screenshots.

## 0.2.0
- Origin + token protection of the local WebSocket, signing wizard, full install manual.
