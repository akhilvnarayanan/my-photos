export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function cursorForPhoto(captureDate: Date, id: string) {
  return `${captureDate.toISOString()}|${id}`;
}

export function parsePhotoCursor(value: string | undefined) {
  if (!value) return null;
  const separator = value.indexOf("|");
  if (separator < 1) return null;
  const captureDate = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  return Number.isNaN(captureDate.getTime()) || !id ? null : { captureDate, id };
}

export function appendUniqueById<T extends { id: string }>(current: T[], incoming: T[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}