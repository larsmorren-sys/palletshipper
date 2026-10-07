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

test('Provider errors distinguish road access, missing routes, gateway failures and unavailable endpoints without leaking upstream data', async () => {
  const previousFetch=globalThis.fetch,previousKey=process.env.ORS_API_KEY;process.env.ORS_API_KEY='secret-routing-test-key';
  try {
    for(const [status,code,pattern] of [[404,2010,/not close enough to a road/],[404,2009,/No drivable route/],[400,2004,/distance or request limit/],[400,2002,/rejected the request/],[404,null,/endpoint is unavailable/],[503,null,/temporarily unavailable/]]) {
      globalThis.fetch=async()=>new Response(JSON.stringify({error:{code,message:'secret-routing-test-key echoed request'}}),{status});
      await assert.rejects(()=>providerRequest('openrouteservice/v2/directions/driving-car/json',{coordinates:[[4,51],[5,50]]}),error=>pattern.test(error.message)&&error.message.includes(`HTTP ${status}`)&&!error.message.includes('secret-routing-test-key'));
    }
    globalThis.fetch=async()=>new Response('<html>secret-routing-test-key 400 Bad Request</html>',{status:400});
    await assert.rejects(()=>providerRequest('openrouteservice/v2/directions/driving-car/json',{}),error=>error.message.includes('HTTP 400')&&!error.message.includes('secret-routing-test-key'));
    const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE route_cache(key TEXT PRIMARY KEY,outboundKm REAL,returnKm REAL,createdAt INTEGER)');
    try {
      db.prepare('INSERT INTO route_cache VALUES(?,?,?,?)').run(JSON.stringify([[4,51],[5,50]]),100,110,Date.now());
      await assert.rejects(()=>drivingDistances(db,[4,51],[5,50],{refresh:true}),/Outbound route:.*HTTP 400/);
      let calls=0;globalThis.fetch=async()=>++calls===1?new Response(JSON.stringify({routes:[{summary:{distance:1000}}]})):new Response(JSON.stringify({error:{code:2010}}),{status:404});
      await assert.rejects(()=>drivingDistances(db,[4,51],[5,50],{refresh:true}),/Return route:.*ORS 2010/);
      assert.equal(db.prepare('SELECT outboundKm FROM route_cache').get().outboundKm,100,'Failed recalculations preserve the last successful cache');
    } finally{db.close();}
  }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.ORS_API_KEY;else process.env.ORS_API_KEY=previousKey;}
});
