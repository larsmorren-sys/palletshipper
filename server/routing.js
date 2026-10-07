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
    response = await fetch(`https://api.heigit.org/${endpoint}`, { method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', Authorization: process.env.ORS_API_KEY.trim(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  } catch { throw fail('The route service is unavailable. Try again or enter distances manually.'); }
  if ([401, 403].includes(response.status)) throw fail('The route service rejected the API key. Check ORS_API_KEY and its permissions in the HeiGIT dashboard.');
  if (response.status === 429) throw fail('The route service limit has been reached. Try again later or enter distances manually.');
  if (!response.ok) {
    // Only expose status and numeric error codes, never upstream text or headers:
    // provider errors may include credentials or the original request.
    let payload;
    try { payload = await response.json(); } catch {}
    const rawCode = payload?.error?.code;
    const code = Number.isInteger(rawCode) && rawCode >= 2000 && rawCode <= 9999 ? rawCode : null;
    const detail = `HTTP ${response.status}${code ? `, ORS ${code}` : ''}`;
    const kind = body ? 'driving-distance' : 'address-search';
    if (response.status >= 500) throw fail(`The ${kind} service is temporarily unavailable (${detail}). Try again later or enter distances manually.`);
    if (code === 2010) throw fail(`A selected address is not close enough to a road accessible by car (${detail}). Check both address matches and choose the street address or accessible entrance instead of a town or site centre.`);
    if ([2009, 2013, 2014, 2015, 2016].includes(code)) throw fail(`No drivable route connects the selected addresses (${detail}). Check both address matches and whether the locations can be reached by road.`);
    if (code === 2004) throw fail(`The route exceeds the provider's distance or request limit (${detail}). Enter the distance manually.`);
    if ([404, 405].includes(response.status) && !code) throw fail(`The ${kind} endpoint is unavailable (${detail}). Run Test route connection and report this error to the administrator.`);
    throw fail(`The ${kind} service rejected the request (${detail}). Run Test route connection to distinguish a service problem from an address problem, or enter distances manually.`);
  }
  try { return await response.json(); } catch { throw fail('The route service returned an unreadable response.'); }
}
export async function searchAddress(address) {
  if (typeof address !== 'string' || address.trim().length < 5 || address.length > 500) throw fail('Enter a full address, including town and country.');
  const result = await providerRequest(`pelias/v1/search?${new URLSearchParams({ text: address.trim(), size: '5' })}`);
  return (result.features || []).map(feature => ({ address: feature.properties?.label, coordinates: coordinates(feature.geometry?.coordinates) })).filter(feature => feature.address && feature.coordinates);
}
export async function drivingDistances(db, warehouse, outbound, { refresh = false } = {}) {
  coordinates(warehouse); coordinates(outbound);
  if (!warehouse || !outbound) throw fail('Find and select both addresses before calculating distances.');
  const cacheKey = JSON.stringify([warehouse, outbound]);
  const cached = db.prepare('SELECT * FROM route_cache WHERE key=? AND createdAt>?').get(cacheKey, Date.now() - 30 * 86400000);
  if (cached && !refresh) return { outboundKm: cached.outboundKm, returnKm: cached.returnKm };
  const distance = async (points, leg) => {
    let result;
    try { result = await providerRequest('openrouteservice/v2/directions/driving-car/json', { coordinates: points }); }
    catch (error) { throw fail(`${leg}: ${error.message}`); }
    const metres = result.routes?.[0]?.summary?.distance;
    if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0) throw fail('No driving route was found between these addresses.');
    return Math.round(metres / 100) / 10;
  };
  const outboundKm = await distance([warehouse, outbound], 'Outbound route');
  const returnKm = await distance([outbound, warehouse], 'Return route');
  db.prepare('INSERT INTO route_cache VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET outboundKm=excluded.outboundKm,returnKm=excluded.returnKm,createdAt=excluded.createdAt').run(cacheKey, outboundKm, returnKm, Date.now());
  return { outboundKm, returnKm };
}
