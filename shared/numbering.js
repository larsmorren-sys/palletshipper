export const objectNameKey = name => String(name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export const palletName = (number, prefix = 'Pallet', postfix = '') => [String(prefix).trim(), number, String(postfix).trim()].filter(value => value !== '').join(' ');

export function nextPalletNumber(pallets, prefix = 'Pallet', postfix = '') {
  const escape = value => objectNameKey(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before = String(prefix).trim() ? `${escape(prefix)} ` : '';
  const after = String(postfix).trim() ? ` ${escape(postfix)}` : '';
  const pattern = new RegExp(`^${before}(\\d+)${after}$`, 'i');
  return pallets.reduce((highest, pallet) => {
    const match = pattern.exec(objectNameKey(pallet.name));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}
