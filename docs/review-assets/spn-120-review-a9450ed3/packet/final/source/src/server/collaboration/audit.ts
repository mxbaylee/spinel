/** Bounded fields only: never serialize protocol requests, errors or credentials. */
export function auditDeniedEdit(
  userID: string,
  unitID: string,
  stage: 'submitChangeset' | 'applyChangeset' | 'commitChangeset',
) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  console.warn(
    JSON.stringify({
      event: 'collaboration.edit_denied',
      at: new Date().toISOString(),
      stage,
      userID: uuid.test(userID) ? userID : undefined,
      unitID: uuid.test(unitID) ? unitID : undefined,
    }),
  );
}
