export const unitTypes = [['pallet', 'Pallet'], ['case', 'Case'], ['suitcase', 'Suitcase'], ['other', 'Other']];
export const unitTypeLabel = unit => unit.type === 'other' ? unit.otherType || 'Other' : unitTypes.find(([type]) => type === (unit.type || 'pallet'))?.[1] || 'Pallet';
export const unitDistanceFactor = type => type === 'suitcase' ? -0.25 : 1;
