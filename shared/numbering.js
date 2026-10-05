export const objectNameKey = name => String(name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function nextPalletNumber(pallets) {
  return pallets.reduce((highest, pallet) => {
    const match = /^pallet\s+(\d+)$/i.exec(pallet.name.trim());
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}
