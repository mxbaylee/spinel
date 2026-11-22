/** Exact source seams: refuse a changed baseline instead of silently missing evidence. */
export function instrumentPhoneSource(source: string, file: string, observer: string) {
  const replace = (before: string, after: string) => {
    if (source.split(before).length !== 2)
      throw new Error(`Phone observation seam changed: ${file}`);
    source = source.replace(before, after);
  };
  const imports = `import { phoneMark, phoneRequest, phoneError } from ${JSON.stringify(observer)};\n`;
  if (file === 'startupStage.ts') {
    replace(
      'export function startupStage(name: string) {',
      'export function startupStage(name: string) {\n  phoneMark(name);',
    );
    replace(
      'export function startupDone() {',
      "export function startupDone() {\n  phoneMark('done');",
    );
  } else if (file === 'api.ts') {
    replace(
      '  verifyCurrent();\n  const headers:',
      "  const phoneId = path === 'session' ? phoneRequest() : 0;\n  if (phoneId) phoneMark('request-start', phoneId);\n  try {\n  verifyCurrent();\n  const headers:",
    );
    replace(
      '  // Consume a dispatched response',
      "  if (phoneId) phoneMark('headers', phoneId, response.status);\n  // Consume a dispatched response",
    );
    replace(
      '  try {\n    verifyCurrent();',
      "  if (phoneId) phoneMark('body', phoneId);\n  try {\n    verifyCurrent();",
    );
    replace(
      '  if (\n    response.status === 401',
      "  if (phoneId) phoneMark('verified', phoneId);\n  if (\n    response.status === 401",
    );
    replace(
      '  return data;\n}',
      "  return data;\n  } catch (failure) {\n    if (phoneId) phoneMark('request-error', phoneId, phoneError(failure));\n    throw failure;\n  } finally {\n    if (phoneId) phoneMark('request-settled', phoneId);\n  }\n}",
    );
  } else if (file === 'App.tsx') {
    replace(
      '            claimOnlineAccount(user.id);',
      "            phoneMark('account-claim');\n            claimOnlineAccount(user.id);",
    );
    replace(
      '              const runtime = await within(',
      "              phoneMark('runtime-start');\n              const runtime = await within(",
    );
    replace(
      '              verifyAdmission();',
      "              phoneMark('runtime-end');\n              verifyAdmission();",
    );
    replace(
      '            if (ready) {\n              await within(',
      "            if (ready) {\n              phoneMark('device-claim-start');\n              await within(",
    );
    replace(
      '              ).catch(() => {});\n              verifyClaim();',
      "              ).catch(() => {});\n              phoneMark('device-claim-end');\n              verifyClaim();",
    );
    replace(
      '          setRestored(restore ?? null);',
      "          phoneMark('account-published');\n          setRestored(restore ?? null);",
    );
  } else return null;
  return imports + source;
}
