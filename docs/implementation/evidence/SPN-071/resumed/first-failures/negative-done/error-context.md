# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: doc-mobile.spec.ts >> a modern phone Doc handles a viewer upgrade without replacing its native canvas @phone-ordinary
- Location: e2e/doc-mobile.spec.ts:752:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Doc document', exact: true }).getByRole('button', { name: 'Done', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Doc document', exact: true }).getByRole('button', { name: 'Done', exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'Doc document', exact: true }).getByRole('button', { name: 'Done', exact: true })

```

```yaml
- main:
  - region "Your files":
    - region "Document workspace":
      - button "Back to files"
      - heading "Phone journal" [level=1]
      - 'button "Save details: Saved"'
      - status "Connection status": Online
      - button "Online — connected to Spinel"
      - button "People in this document"
      - button "Document actions": ···
      - text: View only
      - button "Enter theatre mode"
      - region "Doc document":
        - status "Save status": All changes saved.
        - paragraph: Tap Edit, then tap the text to write.
        - button "Undo" [disabled]:
          - img
        - button "Redo" [disabled]:
          - img
        - button "Paste":
          - img
          - text: Paste
          - img
        - button "More":
          - img
        - complementary
        - complementary
        - region "Notifications alt+T"
        - region "Notifications alt+T"
- menu:
  - menuitem "Paste"
  - menuitem "Select"
  - menuitem "Select all"
  - menuitem "Paste special"
```

# Test source

```ts
  714 |     await expect(input(page)).not.toBeFocused();
  715 |     if (hasNativeEvidence) expect(await currentNativeText()).toBe(original.body!.dataStream);
  716 |     await page.getByRole('button', { name: 'Formulas', exact: true }).tap();
  717 |     const panel = page.getByRole('dialog', { name: 'Formulas', exact: true });
  718 |     await expect(panel.locator('output')).toHaveText('42', { timeout: 20_000 });
  719 |     await expect(panel.locator('tbody tr')).toHaveCount(30);
  720 |     await expect(panel.getByRole('button', { name: '=40+2', exact: true })).toHaveCount(0);
  721 |     await panel.getByRole('button', { name: 'Close dialog', exact: true }).tap();
  722 |     for (const theme of ['light', 'dark'] as const) {
  723 |       await page.emulateMedia({ colorScheme: theme });
  724 |       await capture(page, info, `guest-reader-${theme}`);
  725 |     }
  726 |     const unchanged = await f.read();
  727 |     expect(unchanged.body).toEqual(original.body);
  728 |     expect(unchanged.documentStyle).toEqual(original.documentStyle);
  729 |     expect(unchanged.settings).toEqual(original.settings);
  730 |     for (const name of ['Document actions', 'Versions', 'My files'])
  731 |       await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  732 |     await expect(page.getByRole('link', { name: 'Your profile', exact: true })).toHaveCount(0);
  733 |     expect(await page.locator('body').innerText()).not.toContain(f.owner.name);
  734 |     expect((await guest.request.get('/api/items')).status()).toBe(401);
  735 |     const revoked = await f.account.request.put(`/api/items/${f.item.id}/link`, {
  736 |       headers: { Origin: baseURL! },
  737 |       data: { role: null },
  738 |     });
  739 |     expect(revoked.ok()).toBe(true);
  740 |     await expect(page.getByText('This link no longer works.', { exact: true })).toBeVisible({
  741 |       timeout: 30_000,
  742 |     });
  743 |     await expect(region).toHaveCount(0);
  744 |     await expect(page.getByText(f.item.name, { exact: true })).toHaveCount(0);
  745 |     expect(f.errors).toEqual([]);
  746 |   } finally {
  747 |     await f.close();
  748 |   }
  749 | });
  750 | 
  751 | for (const flavor of [DocumentFlavor.MODERN, DocumentFlavor.TRADITIONAL])
  752 |   test(`a ${flavor === DocumentFlavor.MODERN ? 'modern' : 'traditional'} phone Doc handles a viewer upgrade without replacing its native canvas @phone-ordinary`, async ({
  753 |     browser,
  754 |     baseURL,
  755 |   }, info) => {
  756 |     test.setTimeout(120_000);
  757 |     const f = await fixture(browser, baseURL!, info, false, flavor);
  758 |     try {
  759 |       const viewer = f.auth.createUser('Phone Doc upgrading viewer');
  760 |       const grant = async (role: 'viewer' | 'editor') => {
  761 |         const response = await f.account.request.put(`/api/items/${f.item.id}/sharing`, {
  762 |           headers: { Origin: baseURL! },
  763 |           data: { userId: viewer.id, role },
  764 |         });
  765 |         expect(response.status(), await response.text()).toBe(200);
  766 |       };
  767 |       await grant('viewer');
  768 |       await f.page.close();
  769 |       const reader = await f.phone();
  770 |       await reader.addCookies([
  771 |         {
  772 |           name: COOKIE_NAME,
  773 |           value: f.auth.createSession(viewer.id).token,
  774 |           url: baseURL!.replace('http:', 'https:'),
  775 |           secure: true,
  776 |           httpOnly: true,
  777 |           sameSite: 'Strict',
  778 |         },
  779 |       ]);
  780 |       const page = await reader.newPage();
  781 |       page.on('pageerror', (error) => f.errors.push(error.message));
  782 |       await page.goto(`/?item=${f.item.id}`);
  783 |       const region = page.getByRole('region', { name: 'Doc document', exact: true });
  784 |       const status = page.getByRole('status', { name: 'Save status', exact: true });
  785 |       const phoneFence = 'View only on this phone. Edit on a larger screen.';
  786 |       await expect(region).toHaveAttribute('data-mobile', 'true');
  787 |       await expect(status).toHaveText(
  788 |         flavor === DocumentFlavor.MODERN ? 'View only.' : phoneFence,
  789 |         { timeout: 30_000 },
  790 |       );
  791 |       const canvas = region.getByLabel('Document canvas', { exact: true });
  792 |       const mounted = (await canvas.elementHandle())!;
  793 |       const original = await f.read();
  794 |       const point = await textPoint(page);
  795 |       await page.touchscreen.tap(point.x, point.y);
  796 |       await page.touchscreen.tap(point.x, point.y);
  797 |       await expect(input(page)).not.toBeFocused();
  798 |       let navigations = 0;
  799 |       page.on('framenavigated', (frame) => {
  800 |         if (frame === page.mainFrame()) navigations++;
  801 |       });
  802 | 
  803 |       await grant('editor');
  804 |       if (flavor === DocumentFlavor.MODERN) {
  805 |         await expect(status).toHaveText('All changes saved.', { timeout: 5_000 });
  806 |         expect(await canvas.evaluate((node, original) => node === original, mounted)).toBe(true);
  807 |         const edit = region.getByRole('button', { name: 'Edit', exact: true });
  808 |         const done = region.getByRole('button', { name: 'Done', exact: true });
  809 |         await expect(edit).toBeVisible();
  810 |         await edit.tap();
  811 |         await beginWriting(page);
  812 |         // A live grant must restore the native exit control as well as typing.
  813 |         // Copy-enabled viewers retain a header with its editing menu hidden.
> 814 |         await expect(done).toBeVisible();
      |                            ^ Error: expect(locator).toBeVisible() failed
  815 |         await done.tap();
  816 |         await expect(input(page)).not.toBeFocused();
  817 |         await expect(edit).toBeVisible();
  818 |         // This is the same native phone input that refused a viewer's taps.
  819 |         // The new grant must re-enable its touch route, not only its save label.
  820 |         await beginWriting(page);
  821 |         await page.keyboard.type('Promoted ');
  822 |         await expect
  823 |           .poll(async () => (await f.read()).body!.dataStream)
  824 |           .toBe('Promoted ' + original.body!.dataStream);
  825 |         await saved(page);
  826 |       } else {
  827 |         // Wait for actual access scans so an unchanged phone label cannot hide
  828 |         // a client that simply failed to notice the editor grant.
  829 |         for (let check = 0; check < 2; check++) {
  830 |           const response = await page.waitForResponse(
  831 |             async (response) =>
  832 |               response.request().method() === 'GET' &&
  833 |               new URL(response.url()).pathname === `/api/items/${f.item.id}` &&
  834 |               response.status() === 200 &&
  835 |               (await response.json()).item.access === 'editor',
  836 |             { timeout: 5_000 },
  837 |           );
  838 |           expect(response.status()).toBe(200);
  839 |         }
  840 |         await expect(status).toHaveText(phoneFence);
  841 |         await expect(region.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  842 |         await expect(region.getByRole('button', { name: 'Format', exact: true })).toHaveCount(0);
  843 |         await page.touchscreen.tap(point.x, point.y);
  844 |         await page.touchscreen.tap(point.x, point.y);
  845 |         await expect(input(page)).not.toBeFocused();
  846 |         await page.keyboard.type('FORBIDDEN PAGINATED UPGRADE');
  847 |         await page.keyboard.press('Enter');
  848 |         await expect(status).toHaveText(phoneFence);
  849 |         expect((await f.read()).body).toEqual(original.body);
  850 |       }
  851 |       const after = await f.read();
  852 |       expect(after.documentStyle).toEqual(original.documentStyle);
  853 |       expect(after.settings).toEqual(original.settings);
  854 |       expect(await canvas.evaluate((node, original) => node === original, mounted)).toBe(true);
  855 |       expect(navigations).toBe(0);
  856 |       await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
  857 |         'Online',
  858 |       );
  859 |       expect(f.errors).toEqual([]);
  860 |     } finally {
  861 |       await f.close();
  862 |     }
  863 |   });
  864 | 
  865 | for (const role of ['owner', 'guest-editor'] as const) {
  866 |   test(`traditional phone Doc is locally read-only without revoking its ${role} grant @phone-ordinary`, async ({
  867 |     browser,
  868 |     baseURL,
  869 |   }, info) => {
  870 |     test.setTimeout(120_000);
  871 |     const f = await fixture(browser, baseURL!, info, true, DocumentFlavor.TRADITIONAL);
  872 |     try {
  873 |       let page = f.page;
  874 |       let path = `/api/items/${f.item.id}`;
  875 |       if (role === 'guest-editor') {
  876 |         const link = await f.account.request.put(`/api/items/${f.item.id}/link`, {
  877 |           headers: { Origin: baseURL! },
  878 |           data: { role: 'editor' },
  879 |         });
  880 |         expect(link.ok()).toBe(true);
  881 |         await f.page.close();
  882 |         const guest = await f.phone();
  883 |         page = await guest.newPage();
  884 |         page.on('pageerror', (error) => f.errors.push(error.message));
  885 |         path = `/api/guest/${f.item.id}`;
  886 |         await page.goto((await link.json()).url);
  887 |       } else await page.goto(`/?item=${f.item.id}`);
  888 |       const region = page.getByRole('region', { name: 'Doc document', exact: true });
  889 |       const status = page.getByRole('status', { name: 'Save status', exact: true });
  890 |       const connection = page.getByRole('status', { name: 'Connection status', exact: true });
  891 |       const note = 'Edit on a larger screen. This Doc keeps its page layout.';
  892 |       const message = 'View only on this phone. Edit on a larger screen.';
  893 |       await expect(region).toHaveAttribute('data-mobile', 'true');
  894 |       await expect(status).toHaveText(message, { timeout: 30_000 });
  895 |       await expect(connection).toHaveText('Online');
  896 |       await expect(region.getByText(note, { exact: true })).toBeVisible();
  897 |       await expect(region.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  898 |       await expect(region.getByRole('button', { name: 'Format', exact: true })).toHaveCount(0);
  899 |       const original = await f.read();
  900 |       expect(original.documentStyle.documentFlavor).toBe(DocumentFlavor.TRADITIONAL);
  901 | 
  902 |       const point = await textPoint(page);
  903 |       await page.touchscreen.tap(point.x, point.y);
  904 |       await page.touchscreen.tap(point.x, point.y);
  905 |       await expect(input(page)).not.toBeFocused();
  906 |       await page.keyboard.type('FORBIDDEN TRADITIONAL PHONE EDIT');
  907 |       await expect(status).toHaveText(message);
  908 |       const afterInput = await f.read();
  909 |       expect(afterInput.body).toEqual(original.body);
  910 |       expect(afterInput.documentStyle).toEqual(original.documentStyle);
  911 |       expect(afterInput.settings).toEqual(original.settings);
  912 | 
  913 |       if (role === 'owner') {
  914 |         await page.getByRole('button', { name: 'Document actions', exact: true }).tap();
```