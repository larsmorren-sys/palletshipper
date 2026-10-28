// Assignment checks the item, never the transport unit or its challenge attribution.
export function assignmentStatuses(statuses, palletId, previousPalletId = null) {
  if (!palletId || palletId === previousPalletId) return statuses;
  const next = JSON.parse(statuses);
  if (!next.outWarehouse) next.outWarehouse = new Date().toISOString();
  return JSON.stringify(next);
}
