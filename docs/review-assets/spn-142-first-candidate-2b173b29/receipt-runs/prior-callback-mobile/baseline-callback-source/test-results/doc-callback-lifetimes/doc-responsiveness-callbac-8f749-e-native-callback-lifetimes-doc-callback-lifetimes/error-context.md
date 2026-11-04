# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: doc-responsiveness-callbacks.spec.ts >> mobile native callback lifetimes
- Location: e2e/doc-responsiveness-callbacks.spec.ts:99:3

# Error details

```
Test timeout of 420000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - link [ref=e6] [cursor=pointer]:
        - /url: /
        - img "Spinel" [ref=e8]
      - generic [ref=e33]:
        - status "Connection status" [ref=e34]: Online
        - button "Online — connected to Spinel" [ref=e35] [cursor=pointer]
    - button "Browse files" [ref=e38] [cursor=pointer]
    - generic [ref=e40]:
      - radiogroup "Appearance" [ref=e42]:
        - radio "Follow system" [checked] [ref=e43] [cursor=pointer]
        - radio [checked] [aria-hidden] [ref=e46]
        - radio "Light" [ref=e47] [cursor=pointer]
        - radio [aria-hidden] [ref=e50]
        - radio "Dark" [ref=e51] [cursor=pointer]
        - radio [aria-hidden] [ref=e54]
      - link "Your profile" [ref=e55] [cursor=pointer]:
        - /url: /profile
  - main [ref=e63]:
    - region "Your files" [ref=e64]:
      - generic [ref=e65]:
        - heading "My files" [level=1] [ref=e66]
        - generic [ref=e67]:
          - button "More actions for My files" [ref=e68] [cursor=pointer]: ···
          - button "New" [ref=e69] [cursor=pointer]
      - region "Search your workspace" [ref=e70]:
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e73]:
              - text: Search files
              - searchbox "Search files" [ref=e74]
            - button "Search options" [ref=e75] [cursor=pointer]
            - radiogroup "File view" [ref=e76]:
              - radio "List" [checked] [ref=e77] [cursor=pointer]
              - radio [checked] [aria-hidden] [ref=e79]
              - radio "Grid" [ref=e80] [cursor=pointer]
              - radio [aria-hidden] [ref=e86]
          - group [ref=e87]:
            - generic "Search help" [ref=e88] [cursor=pointer]
        - paragraph [ref=e89]:
          - text: "Searching:"
          - strong [ref=e90]: All accessible files
      - list "Folder contents" [ref=e92]:
        - listitem [ref=e93]:
          - button "Sustained typing Doc" [ref=e94] [cursor=pointer]:
            - generic [aria-hidden] [ref=e96]: 🍀
            - generic [ref=e97]:
              - strong [ref=e98]: Sustained typing
              - generic [ref=e99]:
                - generic [ref=e100]: Doc
                - generic [ref=e111]: Owner
          - time [ref=e113]: 11/4/2026
          - button "More actions for Sustained typing" [ref=e115] [cursor=pointer]: ···
        - listitem [ref=e116]:
          - button "Trash Recently deleted files" [ref=e117] [cursor=pointer]:
            - generic [ref=e122]:
              - strong [ref=e123]: Trash
              - generic [ref=e124]: Recently deleted files
```