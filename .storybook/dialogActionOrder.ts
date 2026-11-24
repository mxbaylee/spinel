/** Public dialog convention: affirmative action before dismissal, including disabled states. */
export function inspectDialogActionOrder(root: ParentNode = document) {
  const visible = (element: Element) => element.checkVisibility();
  const dialogs =
    root instanceof Element && root.matches('.sp-modal')
      ? [root]
      : Array.from(root.querySelectorAll('.sp-modal'));
  let checked = 0;
  let skipped = 0;
  const violations: string[] = [];
  for (const dialog of dialogs) {
    if (!visible(dialog)) {
      skipped++;
      continue;
    }
    for (const cancel of dialog.querySelectorAll('button')) {
      if (
        !visible(cancel) ||
        !['Cancel', 'Keep offline data', 'Close'].includes(cancel.textContent?.trim() ?? '')
      )
        continue;
      const siblings = Array.from(cancel.parentElement?.children ?? []);
      const affirmative = siblings.find(
        (element) =>
          element.matches('button.sp-primary, button.primary, button.sp-destructive') &&
          visible(element),
      );
      if (!affirmative) {
        skipped++;
        continue;
      }
      checked++;
      if (siblings.indexOf(affirmative) > siblings.indexOf(cancel))
        violations.push('dismissal precedes affirmative in DOM');
      const action = affirmative.getBoundingClientRect();
      const dismissal = cancel.getBoundingClientRect();
      if (
        action.top >= dismissal.bottom - 1 ||
        (action.bottom > dismissal.top + 1 &&
          action.top < dismissal.bottom - 1 &&
          action.left >= dismissal.right - 1)
      )
        violations.push('dismissal precedes affirmative visually');
    }
  }
  return { checked, skipped, violations };
}

/** Selected form/confirmation regressions must not pass when their pair disappears. */
export function assertDialogActionOrder(
  result: ReturnType<typeof inspectDialogActionOrder>,
  requirePair = false,
) {
  if (requirePair && result.checked === 0)
    throw new Error('Required dialog action pair is missing');
  if (result.violations.length) throw new Error(result.violations.join('; '));
}
