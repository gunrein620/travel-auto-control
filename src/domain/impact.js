export function getImpactedItemIds(items, changedItemId, limit = 3) {
  const sorted = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const index = sorted.findIndex((item) => item.id === changedItemId);
  if (index < 0) return [];
  return sorted.slice(index, index + limit).map((item) => item.id);
}
