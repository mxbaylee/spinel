# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: startup-lifecycle.spec.ts >> account startup reporting remains live while actual admission is pending
- Location: e2e/startup-lifecycle.spec.ts:147:1

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - banner [ref=e5]:
    - button "Spinel home" [ref=e6] [cursor=pointer]:
      - img "Spinel" [ref=e8]
      - generic [ref=e33]: spinel
    - radiogroup "Appearance" [ref=e36]:
      - radio "Follow system" [checked] [ref=e37] [cursor=pointer]
      - radio [checked] [aria-hidden] [ref=e40]
      - radio "Light" [ref=e41] [cursor=pointer]
      - radio [aria-hidden] [ref=e44]
      - radio "Dark" [ref=e45] [cursor=pointer]
      - radio [aria-hidden] [ref=e48]
  - main [ref=e49]:
    - region [ref=e50]:
      - paragraph [ref=e51]: PRIVATE BY INVITATION
      - heading "Your workspace." [level=1] [ref=e52]
      - paragraph [ref=e53]: Sheets and Docs, together in a private place.
      - generic [ref=e54]:
        - paragraph [ref=e55]: Use a passkey from your browser, password manager or phone.
        - button "Sign in with a passkey" [ref=e56] [cursor=pointer]
      - button "Need help?" [ref=e60] [cursor=pointer]
  - contentinfo [ref=e61]: Have a shared link? Open it directly to view the document.
```