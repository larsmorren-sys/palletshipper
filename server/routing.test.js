import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchAddress, straightLineDistances, coordinates, providerRequest } from './routing.js';

test('Straight-line distances work worldwide without a key or provider calls, with whole-kilometre symmetry', () => {
  const previousFetch=globalThis.fetch,previousKey=process.env.ORS_API_KEY;
  try {
    delete process.env.ORS_API_KEY;globalThis.fetch=()=>{throw new Error('Distance calculation must never call the provider');};
    const result=straightLineDistances([4.43,50.93],[-122.96,50.12]);
    assert.ok(result.outboundKm>7500 && result.outboundKm<8500);assert.equal(result.outboundKm,result.returnKm);assert.ok(Number.isInteger(result.outboundKm));
    assert.deepEqual(straightLineDistances([-122.96,50.12],[4.43,50.93]),result);
    assert.deepEqual(straightLineDistances([4,51],[4,51]),{outboundKm:0,returnKm:0});
    assert.deepEqual(straightLineDistances([0,0],[180,0]),{outboundKm:20015,returnKm:20015});
    assert.ok(straightLineDistances([179.9,0],[-179.9,0]).outboundKm<30);
    assert.throws(()=>straightLineDistances(null,[4,51]),/select both addresses/);
    assert.throws(()=>coordinates([190,51]),/valid address/);assert.throws(()=>coordinates(['4',51]),/valid address/);
  } finally {globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.ORS_API_KEY;else process.env.ORS_API_KEY=previousKey;}
});

test('Address lookup uses HeiGIT, preserves coordinates and never exposes provider secrets in errors', async () => {
  const previousFetch=globalThis.fetch,previousKey=process.env.ORS_API_KEY;process.env.ORS_API_KEY='secret-routing-test-key';
  try {
    let request;
    globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify({features:[{properties:{label:'Test Street, Belgium'},geometry:{coordinates:[4,51]}}]}));};
    assert.deepEqual(await searchAddress('Test Street, Belgium'),[{address:'Test Street, Belgium',coordinates:[4,51]}]);
    assert.ok(request.url.startsWith('https://api.heigit.org/pelias/v1/search?'));assert.ok(!request.url.includes('secret-routing-test-key'));assert.equal(request.options.headers.Authorization,'secret-routing-test-key');
    for(const [status,pattern] of [[403,/rejected the API key/],[429,/limit/],[404,/endpoint is unavailable/],[503,/temporarily unavailable/],[400,/rejected the request/]]){
      globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'secret-routing-test-key echoed request'}}),{status});
      await assert.rejects(()=>providerRequest('pelias/v1/search'),error=>pattern.test(error.message)&&!error.message.includes('secret-routing-test-key'));
    }
    globalThis.fetch=async()=>new Response('<html>secret-routing-test-key 400 Bad Request</html>',{status:400});
    await assert.rejects(()=>providerRequest('pelias/v1/search'),error=>error.message.includes('HTTP 400')&&!error.message.includes('secret-routing-test-key'));
    delete process.env.ORS_API_KEY;await assert.rejects(()=>searchAddress('Test Street, Belgium'),/not configured/);
  }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.ORS_API_KEY;else process.env.ORS_API_KEY=previousKey;}
});
