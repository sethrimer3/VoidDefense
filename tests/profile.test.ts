import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, randomPlayerName, decodeProfile, flagPixels, covers, PATTERNS, MAX_LAYERS, flagSvg, escapeText, PALETTE } from '../src/profile/model.ts';

test('Names are normalized, length bounded, multilingual, and reject markup/control characters',()=>{
 assert.equal(cleanName('  Oak   Warden  '),'Oak Warden');assert.equal(cleanName('Jose\u0301'),'José');assert.equal(cleanName('雪の城'),'雪の城');
 for(const name of ['', 'A','x'.repeat(25),'<img src=x>','bad\u0000name','🔥🔥','___'])assert.equal(cleanName(name),null);
 assert.equal(escapeText('<&"\''),'&lt;&amp;&quot;&#39;');
});
const rgb=(i:number)=>parseInt(PALETTE[i].hex.slice(1),16);
test('Flag stamps overwrite only their masks, in layer order',()=>{
 const a={base:12,layers:[{pattern:'cross' as const,color:3},{pattern:'roundel' as const,color:2}]};
 const b={base:12,layers:[...a.layers].reverse()};
 assert.equal(flagPixels(a)[11*16+7],rgb(2));assert.equal(flagPixels(b)[11*16+7],rgb(3));
 assert.equal(flagPixels(a)[0],rgb(12));assert.equal(flagPixels(a)[7],rgb(3));assert.notDeepEqual(flagPixels(a),flagPixels(b));
 for(const pattern of PATTERNS){const pixels=flagPixels({base:0,layers:[{pattern,color:1}]});const filled=[...pixels].filter(n=>n===rgb(1)).length;assert.ok(filled>0&&filled<384,pattern);for(let y=0;y<24;y++)for(let x=0;x<16;x++)assert.equal(pixels[y*16+x]===rgb(1),covers(pattern,x,y));}
 const svg=flagSvg(a);assert.match(svg,/viewBox="0 0 16 24"/);assert.match(svg,/crispEdges/);assert.ok(!svg.includes('<script'));
});
test('Profiles survive serialization; missing and malformed profiles require setup without losing progress',()=>{
 const p={name:'Oak Warden',flag:{base:12,layers:[{pattern:'tower' as const,color:3},{pattern:'border' as const,color:7}]}};
 assert.deepEqual(decodeProfile(p),p);
 for(const profile of [null,{}, {name:'A',flag:{base:0,layers:[]}}, {name:'Warden',flag:{base:99,layers:[]}}, {name:'Warden',flag:{base:0,layers:[{pattern:'script',color:3}]}}, {name:'Warden',flag:{base:0,layers:[null]}}, {name:'Warden',flag:{base:0,layers:Array(MAX_LAYERS+1).fill({pattern:'cross',color:3})}}]){
  assert.equal(decodeProfile(profile),undefined);
 }
});

test('Opacity blends layers over the composed flag and preserves old fully opaque flags',()=>{
 const old={name:'Warden',flag:{base:1,layers:[{pattern:'cross' as const,color:7}]}};
 assert.deepEqual(decodeProfile(old),old);
 for(const opacity of [25,50,75,100] as const){
  const p={name:'Warden',flag:{base:1,layers:[{pattern:'cross' as const,color:7,opacity}]}};
  assert.deepEqual(decodeProfile(p),p);
  const alpha=opacity/100,channel=(a:number,b:number)=>Math.round(a*(1-alpha)+b*alpha);
  const expected=(channel(37,244)<<16)|(channel(38,241)<<8)|channel(49,229);
  assert.equal(flagPixels(p.flag)[11*16+7],expected);
  assert.equal(flagPixels(p.flag)[0],rgb(1));
  assert.ok(flagSvg(p.flag).includes(`#${expected.toString(16).padStart(6,'0')}`));
 }
 const mixed={base:1,layers:[{pattern:'cross' as const,color:7,opacity:50 as const},{pattern:'roundel' as const,color:2,opacity:50 as const}]};
 // White over coal, then crimson over that blend, with rounding per stamp.
 assert.equal(flagPixels(mixed)[11*16+7],(155<<16)|(95<<8)|102);
 assert.notDeepEqual(flagPixels(mixed),flagPixels({...mixed,layers:[...mixed.layers].reverse()}));
 for(const opacity of [0,1,33,101,'50',null])assert.equal(decodeProfile({...old,flag:{base:1,layers:[{pattern:'cross',color:7,opacity}]}}),undefined);
});

test('Random player names have four digits and survive save decoding',()=>{
 for(let i=0;i<100;i++){
  const name=randomPlayerName();assert.match(name,/^player#[0-9]{4}$/);
  const p={name,flag:{base:12,layers:[]}};
  assert.deepEqual(decodeProfile(p),p);
 }
});
