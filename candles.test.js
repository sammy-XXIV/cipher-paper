import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCandles,updateCandle,historyRange} from './candles.js';
test('history request covers at least 24 hours at every supported interval',()=>{for(const minutes of [5,15,60]){const r=historyRange(minutes,1795028400000);assert.ok(r.end-r.start>=86400);assert.equal(r.start%(minutes*60),0);}});
test('MEXC arrays become sorted valid OHLC candles; duplicates and invalid bars removed',()=>{const c=parseCandles({time:[1800,900,1800,2700],open:[2,1,2,0],high:[4,3,5,0],low:[1,1,1,0],close:[3,2,4,0],vol:[10,20,30,0]});assert.equal(c.length,2);assert.equal(c[0].time,900);assert.equal(c[1].close,4);});
test('ticks update current candle and rollover without inventing bars during a gap',()=>{const c=[{time:900,open:100,high:101,low:99,close:100,volume:10}];updateCandle(c,105,15,1500000);assert.equal(c[0].open,100);assert.equal(c[0].high,105);assert.equal(c[0].close,105);updateCandle(c,98,15,3600000);assert.equal(c.length,2);assert.equal(c[1].time,3600);assert.equal(c[1].open,98);});
