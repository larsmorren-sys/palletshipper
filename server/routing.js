const fail = message => Object.assign(new Error(message), { status: 400 });
export const routingConfigured = () => !!process.env.ORS_API_KEY?.trim();
export function coordinates(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw fail('Select a valid address match.');
  return value;
}
export async function providerRequest(endpoint, body) {
  if (!routingConfigured()) throw fail('Automatic distances are not configured. Ask an administrator to set ORS_API_KEY, or enter distances manually.');
  let response;
  try {
    response = await fetch(`https://api.heigit.org/${endpoint}`, { method: body ? 'POST' : 'GET', headers: { Authorization: process.env.ORS_API_KEY.trim(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  } catch { throw fail('The route service is unavailable. Try again or enter distances manually.'); }
  if ([401, 403].includes(response.status)) throw fail('The route service rejected the API key. Check ORS_API_KEY and its permissions in the HeiGIT dashboard.');
  if (response.status === 429) throw fail('The route service limit has been reached. Try again later or enter distances manually.');
  if (!response.ok) throw fail('The route service could not find this address or route. Check the addresses or enter distances manually.');
  try { return await response.json(); } catch { throw fail('The route service returned an unreadable response.'); }
}
export async function searchAddress(address) {
  if (typeof address !== 'string' || address.trim().length < 5 || address.length > 500) throw fail('Enter a full address, including town and country.');
  const result = await providerRequest(`pelias/v1/search?${new URLSearchParams({ text: address.trim(), size: '5' })}`);
  return (result.features || []).map(feature => ({ address: feature.properties?.label, coordinates: coordinates(feature.geometry?.coordinates) })).filter(feature => feature.address && feature.coordinates);
}
export async function drivingDistances(db, warehouse, outbound) {
  coordinates(warehouse); coordinates(outbound);
  if (!warehouse || !outbound) throw fail('Find and select both addresses before calculating distances.');
  const cacheKey = JSON.stringify([warehouse, outbound]);
  const cached = db.prepare('SELECT * FROM route_cache WHERE key=? AND createdAt>?').get(cacheKey, Date.now() - 30 * 86400000);
  if (cached) return { outboundKm: cached.outboundKm, returnKm: cached.returnKm };
  const distance = async points => {
    const result = await providerRequest('openrouteservice/v2/directions/driving-car/json', { coordinates: points });
    const metres = result.routes?.[0]?.summary?.distance;
    if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0) throw fail('No driving route was found between these addresses.');
    return Math.round(metres / 100) / 10;
  };
  const outboundKm = await distance([warehouse, outbound]);
  const returnKm = await distance([outbound, warehouse]);
  db.prepare('INSERT INTO route_cache VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET outboundKm=excluded.outboundKm,returnKm=excluded.returnKm,createdAt=excluded.createdAt').run(cacheKey, outboundKm, returnKm, Date.now());
  return { outboundKm, returnKm };
}
