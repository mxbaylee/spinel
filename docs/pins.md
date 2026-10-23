# Personal pins — retired

The owner removed personal pinning and all pinned-item UI on the SPN-047
redesign branch on 2026-10-21 ([decision #128](implementation/SPN-047.md#legacy-decision-128-remove-personal-pinning)). Files and folders have no Pin/Unpin action,
pinned badge, pinned list or reorder controls. Do not reintroduce this feature
as favorites, shortcuts or disabled UI in a later screen migration.

Use My files, Shared with me, folders, personal tags and search for retrieval.
Removing pinning does not remove files, change sharing, change personal folder
placement or affect named version retention. Browser home-screen shortcuts and
offline downloads remain separate features.

This supersedes the personal-pins guidance from
[decision #64](implementation/SPN-020.md#legacy-decision-64-personal-pins), 2026-10-18.
That decision and earlier review evidence remain historical records; they are
not current implementation requirements. The owner explicitly requested removal
because the feature and its UI were unnecessary (chat, 2026-10-21).
