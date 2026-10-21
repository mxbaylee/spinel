/** Parse the cursor-only Sheet wire format; reject unsupported or unsafe addresses. */
export function parseSheetSelection(value: string) {
  const separator = value.lastIndexOf('!');
  if (separator < 1) return;
  const sheetId = value.slice(0, separator),
    address = value.slice(separator + 1);
  if (!/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address)) return;
  if (address.split(':').some((cell) => !Number.isSafeInteger(Number(cell.replace(/^[A-Z]+/, '')))))
    return;
  return { sheetId, address };
}
