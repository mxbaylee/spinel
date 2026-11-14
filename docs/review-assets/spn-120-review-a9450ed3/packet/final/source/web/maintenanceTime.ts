/** Resolve a local minute without allowing Date to silently choose a DST fold or gap. */
export function maintenanceInstants(local: string, timeZone: string): number[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error('Choose a complete date and time.');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  if (year < 2000 || year > 2200 || new Date(nominal).toISOString().slice(0, 16) !== local)
    throw new Error('Choose a valid date and time.');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const wall = (instant: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  };
  // Sample both sides of possible transitions, including half-hour shifts and
  // date-line changes. Only candidates whose complete wall time matches survive.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours++) {
    const instant = nominal + hours * 3_600_000;
    offsets.add(wall(instant) - instant);
  }
  return [...offsets]
    .map((offset) => nominal - offset)
    .filter((instant) => wall(instant) === nominal)
    .sort((left, right) => left - right);
}

export function maintenanceTime(instant: number, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
      ...(timeZone && { timeZone }),
    }).format(instant);
  } catch {
    return new Date(instant).toISOString();
  }
}

export function maintenanceOffset(instant: number, timeZone: string) {
  return (
    new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  );
}
