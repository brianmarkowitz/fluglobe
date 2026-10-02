import test from 'node:test';
import assert from 'node:assert/strict';
import { globePoint } from '../src/globeMath.js';
import { monthlyCounts } from '../src/timeline.js';
const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-8, `${actual} != ${expected}`);
test('globe cardinal coordinates align with the equirectangular texture',()=>{
  const greenwich=globePoint(0,0), east=globePoint(0,90), pole=globePoint(90,0);
  near(greenwich.x,1);near(greenwich.z,0);near(east.z,-1);near(east.x,0);near(pole.y,1);
});
test('camera focus preserves requested radius and longitude wraps at the dateline',()=>{
  near(globePoint(35,138,3.2).length(),3.2);
  near(globePoint(-20,180).distanceTo(globePoint(-20,-180)),0);
});
test('timeline counts records rather than cases, orders months, and excludes invalid dates',()=>{
  assert.deepEqual(monthlyCounts([{date:'2025-01',cases:5000},{date:'2024-12-03'},{date:'2025-01'},{date:'2025-13'},{date:null}]),{'2024-12':1,'2025-01':2});
  assert.deepEqual(monthlyCounts([]),{});
});
