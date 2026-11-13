# SPN-149 diagnostic event terminology clarification

The diagnostic event named `page-close` records the matching Playwright **WebSocket object's `close` callback**. It does not record closing the Page or browser tab. The reviewed source registers this listener in `e2e/session-revocation.ts`, in `pageSocket`, using `socket.on('close', onClose)`.

In the initial fixed-sample audit, the labels “Playwright page close” and “Playwright’s page close” should be read as this page-associated WebSocket callback. Independent protocol closure is the separate `socket-closed` event from `Network.webSocketClosed`. The navigation event records main-frame navigation.

This clarification changes no observation, timing, assertion outcome, score, fixed-sample scope, raw diagnostic byte, hash or historical-cause limitation. The original fixed-sample files and exact diagnostic bytes remain unchanged. Append this explanation to the maintained receipt to make the terminology precise. Later ordinary-acceptance audit narratives use the explicit label “Playwright WebSocket close callback.”
