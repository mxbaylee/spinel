/** Account IDs are Operator metadata; only duplicate names need disambiguation. */
export function adminAccountLabel(
  account: { id: string; name: string },
  accounts: readonly { id: string; name: string }[],
): string {
  return accounts.some((other) => other.id !== account.id && other.name === account.name)
    ? `${account.name} (${account.id})`
    : account.name;
}
