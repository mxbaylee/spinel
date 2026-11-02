# SPN-071 current hosted production views

These 14 byte-for-byte application captures come from CI 41430568768 attempt 1,
production job 125227939343: 81 passed, three declared skips, no test retries.
Head c51458573f3a2cf2f5ff3701cf27abfcfe035935 integrates main
cc8364693791d981b86e80efc40bedba7fff2c08. Tested merge
3ddf9dcb01807ce23a78118a9a7c45f7fd164d14 has the same tree
58e16d0b5e1c4d34d5d74a4aaf0cfd73c548523d. All 33 CI jobs and all seven gates
passed on this run. Storybook 41430568554 also passed. These are current-source
captures, superseding source53 and qualified shared-install local native images.

The manifest identifies the original artifact and hash; the retained production
log establishes clean npm ci and all current postinstall patchers. Other tickets'
images in that ZIP are omitted. Desktop menu/access dialog views are 1280x900;
hidden-list and native Doc phone views are 390x844 Chromium emulation, not physical
devices. Light/dark themes are named in filenames. Linux hosted fonts may differ
from local macOS. The phone sequence covers viewer, live upgrade with Done,
return to reading with Edit, and Traditional layout's editing restriction.

Original proposed production-component fixtures remain in PR226. Native runtime
and component evidence are distinct. Independent review must inspect these actual
images on c514585; this archive alone is not visual approval. Agent review only.

Earlier source53 mobile 165.8ms failure, bounded diagnostics, private-install
resource abort, and restore/focus failures remain in linked immutable archives.
No historical failure is reclassified as a pass. SPN132's separate acceptance
is not substituted for the current combined run.
