const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPLICIT_OFFSET = /T.*(?:Z|[+-]\d{2}:\d{2})$/i;

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function localDateTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number },
  timeZone: string,
) {
  const desiredAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond);
  let candidate = desiredAsUtc;
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = zonedParts(candidate, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, local.millisecond);
    const adjustment = desiredAsUtc - actualAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return candidate;
}

export function parseSupplierArrival(value: string | null, timeZone: string): number | undefined {
  if (!value || !isValidTimeZone(timeZone)) return undefined;
  const dateOnly = DATE_ONLY.exec(value.trim());
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const numericYear = Number(year);
    const numericMonth = Number(month);
    const numericDay = Number(day);
    const calendarCheck = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
    if (
      calendarCheck.getUTCFullYear() !== numericYear
      || calendarCheck.getUTCMonth() + 1 !== numericMonth
      || calendarCheck.getUTCDate() !== numericDay
    ) return undefined;
    const parsed = localDateTimeToUtc({
      year: numericYear,
      month: numericMonth,
      day: numericDay,
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999,
    }, timeZone);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (!EXPLICIT_OFFSET.test(value.trim())) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
