const {chromium}=require('C:/Users/Dell/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://cipher-paper.test/**',async r=>{const n=new URL(r.request().url()).pathname.slice(1)||'index.html';try{await r.fulfill({body:await fs.readFile(path.join(__dirname,n)),contentType:n.endsWith('.html')?'text/html':n.endsWith('.js')?'text/javascript':n.endsWith('.css')?'text/css':'application/json'});}catch{await r.fulfill({status:404,body:'Missing'});}});
await page.setViewportSize({width:390,height:844});await page.goto(process.env.PAPER_URL||'https://cipher-paper.test/');await page.waitForFunction(()=>+document.querySelector('#priceChart').dataset.historyHours>=24,{},{timeout:30000});
for(const width of [320,360,390,430,768]){
 await page.setViewportSize({width,height:844});
 if(width<761){for(const view of ['trade','chart','account']){
  await page.locator(`.mobile-views [data-mobile-view="${view}"]`).click();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}px ${view}: no horizontal overflow`);
  assert.equal(await page.locator('.chart-panel').isVisible(),view==='chart');assert.equal(await page.locator('.trade-panel').isVisible(),view==='trade');assert.equal(await page.locator('.account-panel').isVisible(),view==='account');
  if(width===390)await page.screenshot({path:`preview-mobile-${view}.png`,fullPage:true});
 }}else assert.equal(await page.locator('.trade-panel').isVisible(),true);
}
await page.setViewportSize({width:390,height:844});await page.locator('.mobile-views [data-mobile-view="trade"]').click();await page.locator('#settingsButton').click();await page.locator('#feedSelect').selectOption('demo');await page.locator('#saveSettings').click();await page.locator('#marginAmount').fill('100');await page.locator('#longButton').click();assert.equal(await page.locator('#positionCount').innerText(),'1');await page.locator('[data-close]').click();assert.equal(await page.locator('#positionCount').innerText(),'0');await page.locator('#pairButton').click();await page.locator('#pairSearch').fill('ETH');await page.locator('[data-symbol="ETH_USDT"]').click();assert.match(await page.locator('#pairName').innerText(),/ETH/);
await page.locator('.mobile-views [data-mobile-view="chart"]').click();await page.locator('[data-interval="5"]').click();assert.ok(+(await page.locator('#priceChart').getAttribute('data-history-hours'))>=24);assert.deepEqual(errors,[]);console.log('PASS: 320/360/390/430/768px, Trade/Chart/Account views, no overflow, order entry/close, pair picker, candle interval.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
