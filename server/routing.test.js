import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { searchAddress, drivingDistances, coordinates, providerRequest } from './routing.js';

test('Routing uses HeiGIT endpoints, validates matches, caches each direction and protects the API key', async () => {
  const previousFetch=globalThis.fetch, previousKey=process.env.ORS_API_KEY;
  process.env.ORS_API_KEY='routing-test-key';
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE route_cache(key TEXT PRIMARY KEY,outboundKm REAL,returnKm REAL,createdAt INTEGER)');
  const calls=[];
  try {
    globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('pelias')?{features:[{properties:{label:'Test Street, Belgium'},geometry:{coordinates:[4,51]}}]}:{routes:[{summary:{distance:calls.length===2?12345:14567}}]}),{status:200});};
    assert.deepEqual(await searchAddress('Test Street, Belgium'),[{address:'Test Street, Belgium',coordinates:[4,51]}]);
    const result=await drivingDistances(db,[4,51],[5,50]);assert.deepEqual(result,{outboundKm:12.3,returnKm:14.6});
    assert.equal(calls[0].url.startsWith('https://api.heigit.org/pelias/v1/search?'),true);
    assert.equal(calls[1].url,'https://api.heigit.org/openrouteservice/v2/directions/driving-car/json');
    assert.equal(calls.every(c=>!c.url.includes('routing-test-key')),true);assert.equal(calls[0].options.headers.Authorization,'routing-test-key');
    assert.deepEqual(JSON.parse(calls[2].options.body).coordinates,[[5,50],[4,51]]);
    assert.deepEqual(await drivingDistances(db,[4,51],[5,50]),result);assert.equal(calls.length,3);
    globalThis.fetch=async()=>new Response('secret-provider-error routing-test-key',{status:403});
    await assert.rejects(()=>providerRequest('pelias/v1/search'),error=>error.message.includes('rejected the API key')&&!error.message.includes('routing-test-key'));
    globalThis.fetch=async()=>new Response('',{status:429});await assert.rejects(()=>providerRequest('pelias/v1/search'),/limit/);
    delete process.env.ORS_API_KEY;await assert.rejects(()=>searchAddress('Test Street, Belgium'),/not configured/);
    assert.throws(()=>coordinates([190,51]),/valid address/);assert.throws(()=>coordinates(['4',51]),/valid address/);
  } finally {globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.ORS_API_KEY;else process.env.ORS_API_KEY=previousKey;db.close();}
});
