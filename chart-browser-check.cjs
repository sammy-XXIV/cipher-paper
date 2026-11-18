// Browser verification with request interception: no HTTP server or localhost listener.
const {chromium}=require('C:/Users/Dell/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1040}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cipher-paper.test/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1)||'index.html';try{const body=await fs.readFile(path.join(__dirname,name));await route.fulfill({body,contentType:name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/json'});}catch{await route.fulfill({status:404,body:'Not found'});}});
 await page.goto('https://cipher-paper.test/');await page.waitForFunction(()=>Number(document.querySelector('#priceChart').dataset.historyHours)>=24,{},{timeout:30000});
 const candles=await page.locator('#priceChart').getAttribute('data-candles');assert.ok(+candles>=97);console.log('LIVE 15m:',candles,'candles;',await page.locator('#historyStatus').innerText());
 await page.screenshot({path:'preview-candles-desktop.png',fullPage:true});
 await page.locator('[data-interval="5"]').click();await page.waitForFunction(()=>document.querySelector('#priceChart').dataset.interval==='5'&&+document.querySelector('#priceChart').dataset.candles>=289,{},{timeout:30000});
 await page.locator('[data-interval="60"]').click();await page.waitForFunction(()=>document.querySelector('#priceChart').dataset.interval==='60'&&+document.querySelector('#priceChart').dataset.candles>=25,{},{timeout:30000});
 await page.locator('#pairButton').click();await page.locator('#pairSearch').fill('SOL');await page.locator('[data-symbol="SOL_USDT"]').click();await page.waitForFunction(()=>document.querySelector('#historyStatus').innerText==='24h history',{},{timeout:30000});assert.match(await page.locator('#pairName').innerText(),/SOL/);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'preview-candles-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // History fetches must never produce trades or alter virtual balance.
 assert.equal(await page.locator('#positionCount').innerText(),'0');assert.equal(await page.locator('#walletBalance').innerText(),'10,000.00');
 await page.locator('#settingsButton').click();await page.locator('#feedSelect').selectOption('demo');await page.locator('#saveSettings').click();await page.waitForFunction(()=>+document.querySelector('#priceChart').dataset.historyHours>=24);assert.match(await page.locator('#chartLabel').innerText(),/Simulated/);
 assert.deepEqual(errors,[]);console.log('PASS: real MEXC 24h candles at 5m/15m/1h, pair switching, mobile, demo labels, no history-triggered trades.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
