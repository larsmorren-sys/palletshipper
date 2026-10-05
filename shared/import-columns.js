const aliases = {
  name: ['omschrijving', 'description', 'item description', 'product description', 'name', 'naam', 'materiaal', 'object', 'artikel', 'product', 'item'],
  code: ['code', 'artikelnummer', 'artikel nr', 'artikelnr', 'artikelcode', 'article number', 'item number', 'item no', 'product code', 'sku', 'referentie', 'reference', 'ref'],
  quantity: ['aantal', 'quantity', 'qty', 'stuks', 'aant', 'hoeveelheid', 'quantiteit', 'qte', 'qté'],
};
export const normalizeHeader = value => String(value).toLowerCase().normalize('NFKC').replace(/[._:\-/]+/g, ' ').replace(/\s+/g, ' ').trim();
export function detectColumns(row) {
  const cells = row.map(normalizeHeader);
  return Object.fromEntries(Object.entries(aliases).map(([key, words]) => [key, cells.findIndex(cell => words.includes(cell))]));
}
export function isMaterialHeader(row) {
  return Object.values(detectColumns(row)).filter(index => index >= 0).length >= 2;
}
