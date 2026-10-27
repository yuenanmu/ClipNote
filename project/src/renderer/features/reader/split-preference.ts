export const SPLIT_PREFERENCE = 'clipnote.reader.split.v1';
export function boundSplitRatio(ratio: number, width: number) {
  const available = Number.isFinite(width) ? Math.max(560, width - 8) : 1000, minimum = 280 / available;
  return Math.max(minimum, Math.min(1 - minimum, Number.isFinite(ratio) ? ratio : .4));
}
export function readSplitRatio(storage: Pick<Storage, 'getItem'>) {
  try { const raw = storage.getItem(SPLIT_PREFERENCE), value = Number(raw); return raw?.trim() && Number.isFinite(value) && value > 0 && value < 1 ? value : .4; }
  catch { return .4; }
}
