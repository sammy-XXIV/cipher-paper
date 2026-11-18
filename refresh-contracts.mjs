import {readFile,writeFile} from 'node:fs/promises';
const url='https://contract.mexc.com/api/v1/contract/detail';
const response=process.argv.includes('--compact')?JSON.parse(await readFile(new URL('./contracts.json',import.meta.url),'utf8')):await fetch(url).then(r=>{if(!r.ok)throw Error(`MEXC ${r.status}`);return r.json();});
if(!Array.isArray(response.data)||!response.data.length)throw Error('No contracts returned; preserving previous snapshot.');
const fields=['symbol','baseCoin','quoteCoin','state','isHidden','priceScale','contractSize','maxLeverage'];
const data=response.data.map(c=>Object.fromEntries(fields.map(k=>[k,c[k]])));
await writeFile(new URL('./contracts.json',import.meta.url),JSON.stringify({source:url,updated:new Date().toISOString(),data}));
console.log(`Saved ${data.length} MEXC contracts.`);
