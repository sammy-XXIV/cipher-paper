import {account,open,close,tick,pnl,available,equity,liquidation,validate,FEE} from './engine.js';
import {parseCandles,updateCandle,historyRange} from './candles.js';
const $=id=>document.getElementById(id), money=(n,d=2)=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}}
let settings=read('cipher-paper-settings',{feed:'live',proxy:''}),s,contracts=[],symbol='BTC_USDT',leverage=20,orderType='market',action='open',view='positions';
let prices={},marks={},received={},meta={},candles=[],socket,heartbeat,retryTimer,demoTimer,generation=0,storageWarned=false;
let chartMinutes=15,historyVersion=0,historyState='loading',historyError='',historyController;
const DEFAULT_PROXY='https://cipher-paper-market.samsonsamuel531.workers.dev';
const marketBase=()=>settings.proxy?.replace(/\/$/,'')||DEFAULT_PROXY;
const key=()=>`cipher-paper-v1-${settings.feed}`;
function load(){s=read(key(),account());if(s.version!==1||!Array.isArray(s.positions)||!Array.isArray(s.orders)||!Array.isArray(s.history)||!Number.isFinite(s.balance))s=account();}
function save(){try{localStorage.setItem(key(),JSON.stringify(s));}catch{if(!storageWarned){toast('Browser storage is unavailable or full. Your changes may not survive a reload.');storageWarned=true;}}}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),4300);}
const contract=()=>contracts.find(c=>c.symbol===symbol)||{symbol,baseCoin:symbol.split('_')[0],priceScale:2,contractSize:1};
const fmt=(price,sym=symbol)=>price==null?'—':money(price,Math.min(10,contracts.find(c=>c.symbol===sym)?.priceScale??(price<1?6:2)));
const fresh=sym=>prices[sym]>0&&Date.now()-(received[sym]||0)<15000;
const freshPrices=()=>Object.fromEntries(Object.entries(prices).filter(([sym])=>fresh(sym)));
const color=n=>n>=0?'green':'red',signed=n=>(n>=0?'+':'')+money(n);
function status(text,cls=''){const el=$('feedStatus');el.textContent='● '+text;el.className='feed-status '+cls;}
function subscriptions(){return [...new Set([symbol,...s.positions.map(p=>p.symbol),...s.orders.map(o=>o.symbol)])];}
function subscribe(){if(socket?.readyState!==1)return;for(const sym of subscriptions())socket.send(JSON.stringify({method:'sub.ticker',param:{symbol:sym}}));socket.send(JSON.stringify({method:'sub.depth.full',param:{symbol,limit:20}}));}
function accept(sym,data){
 const price=Number(data.lastPrice);if(!(price>0)||!Number.isFinite(price))return;
 prices[sym]=price;received[sym]=Date.now();marks[sym]=+data.fairPrice||price;meta[sym]=data;
 // Liquidation uses mark price; entries, limits and protective orders use last price.
 const valid=freshPrices();const markPrices=Object.fromEntries(Object.keys(valid).map(k=>[k,marks[k]||valid[k]]));
 if(tick(s,valid,markPrices)){save();subscribe();}
 if(sym===symbol){updateCandle(candles,price,chartMinutes);draw();status(settings.feed==='demo'?'Demo · simulated':'MEXC live',settings.feed==='demo'?'demo':'live');}
 render();
}
function connect(){
 const gen=++generation;clearInterval(heartbeat);clearInterval(demoTimer);clearTimeout(retryTimer);if(socket){socket.onclose=null;socket.close();}socket=null;
 prices={};marks={};received={};meta={};candles=[];book([],[]);draw();render();
 if(settings.feed==='demo'){status('Demo · simulated','demo');$('chartLabel').textContent='Simulated feed · Demo';$('bookNote').textContent='Simulated depth · Demo only';runDemo();return;}
 status('Connecting');$('chartLabel').textContent='MEXC · Last price';$('bookNote').textContent='Live MEXC depth';
 loadHistory();
 try{socket=new WebSocket('wss://contract.mexc.com/edge');}catch{status('Connection unavailable');return;}
 socket.onopen=()=>{if(gen!==generation)return;subscribe();heartbeat=setInterval(()=>{if(socket?.readyState===1)socket.send(JSON.stringify({method:'ping'}));},15000);};
 socket.onmessage=e=>{if(gen!==generation)return;try{const d=JSON.parse(e.data);if(d.channel==='push.ticker')accept(d.symbol||d.data.symbol,d.data);if(d.channel==='push.depth.full'&&d.symbol===symbol)book(d.data.asks||[],d.data.bids||[]);}catch(error){console.warn('Market message:',error.message);}};
 socket.onerror=()=>status('Feed unavailable · retrying');
 socket.onclose=()=>{if(gen!==generation)return;clearInterval(heartbeat);status('Disconnected · retrying');render();retryTimer=setTimeout(connect,5000);};
 refreshRest(gen);
}
async function refreshRest(gen){try{const res=await fetch(marketBase()+'/api/v1/contract/ticker',{signal:AbortSignal.timeout(10000)});const d=await res.json();if(gen!==generation)return;for(const t of d.data||[])if(subscriptions().includes(t.symbol))accept(t.symbol,t);}catch{ /* WebSocket remains the primary feed. */ }}
async function loadHistory(){
 const version=++historyVersion,sym=symbol,minutes=chartMinutes;historyController?.abort();historyController=new AbortController();const controller=historyController;
 candles=[];historyState='loading';historyError='';draw();
 if(settings.feed==='demo'){seedDemoCandles();return;}
 const {start,end}=historyRange(minutes),path=`/api/v1/contract/kline/${encodeURIComponent(sym)}?interval=Min${minutes}&start=${start}&end=${end}`;
 const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const r=await fetch(marketBase()+path,{signal:controller.signal});if(!r.ok)throw Error('History service returned '+r.status);
  const d=await r.json(),history=parseCandles(d.data).filter(c=>c.time>=start&&c.time<=end);
  if(version!==historyVersion||sym!==symbol||minutes!==chartMinutes)return;
  if(!history.length)throw Error('No historical candles available for this pair');
  // Merge only session ticks newer than the last historical candle. Never replay historical bars through the trading engine.
  const current=candles.at(-1),last=history.at(-1);
  if(current&&current.time===last.time){last.high=Math.max(last.high,current.high);last.low=Math.min(last.low,current.low);last.close=current.close;}
  else if(current&&current.time>last.time)history.push(current);
  candles=history;historyState='ready';draw();
 }catch(e){if(version!==historyVersion)return;historyState='error';historyError=e.name==='AbortError'?'History request timed out':e.message;draw();}
 finally{clearTimeout(timer);}
}
function seedDemoCandles(){
 historyController?.abort();historyVersion++;candles=[];const interval=chartMinutes*60,now=Math.floor(Date.now()/1000/interval)*interval,count=Math.ceil(1440/chartMinutes),target=prices[symbol]||demoSeeds[symbol.split('_')[0]]||12.46;let price=target;
 for(let i=count;i>=0;i--){const open=price,close=open*(1+(Math.random()-.49)*.006);candles.push({time:now-i*interval,open,high:Math.max(open,close)*(1+Math.random()*.002),low:Math.min(open,close)*(1-Math.random()*.002),close,volume:Math.random()*1000});price=close;}
 const scale=target/price;for(const c of candles)for(const k of ['open','high','low','close'])c[k]*=scale;
 historyState='ready';draw();
}
const demoSeeds={BTC:63224.9,ETH:2046.2,SOL:87.12,DOGE:.112,PEPE:.0000046,XRP:1.34,BNB:615.2};
function runDemo(){
 const seed=sym=>demoSeeds[sym.split('_')[0]]||12.46;
 for(const sym of subscriptions())prices[sym]=seed(sym);
 seedDemoCandles();
 function frame(){for(const sym of subscriptions()){const p=(prices[sym]||seed(sym))*(1+(Math.random()-.5)*.001);accept(sym,{lastPrice:p,fairPrice:p,riseFallRate:p/seed(sym)-1,high24Price:seed(sym)*1.035,lower24Price:seed(sym)*.972,amount24:184039286});}
 const p=prices[symbol],step=Math.max(p*.00001,10**-(contract().priceScale||2));book(Array.from({length:8},(_,i)=>[p+step*(i+1),10+Math.random()*300]),Array.from({length:8},(_,i)=>[p-step*(i+1),10+Math.random()*300]),true);}
 frame();demoTimer=setInterval(frame,1000);
}
function book(asks,bids,isDemo=false){
 const factor=isDemo?1:(+contract().contractSize||1),topA=asks.slice(0,8),topB=bids.slice(0,8),max=Math.max(1,...topA.map(x=>+x[1]),...topB.map(x=>+x[1]));
 const rows=(levels,side)=>levels.map(([p,v])=>`<div class="book-row ${side}" style="--depth:${Math.max(2,v/max*100)}%"><span>${fmt(+p)}</span><span>${(+v*factor).toLocaleString('en-US',{maximumFractionDigits:4})}</span></div>`).join('');
 $('asks').innerHTML=rows(topA.reverse(),'ask');$('bids').innerHTML=rows(topB,'bid');
 const a=topA.reduce((n,x)=>n+ +x[1],0),b=topB.reduce((n,x)=>n+ +x[1],0),ratio=a+b?Math.round(b/(a+b)*100):50;
 $('buyRatio').textContent=a+b?`B ${ratio}%`:'B —';$('sellRatio').textContent=a+b?`${100-ratio}% S`:'— S';$('ratioFill').style.width=ratio+'%';
}
function render(){
 const price=prices[symbol],m=meta[symbol]||{},change=(+m.riseFallRate||0)*100,eq=equity(s,marks),upnl=eq-s.balance;
 $('pairName').innerHTML=esc(symbol.replace('_',''))+' <small>▾</small>';
 document.querySelector('.coin-icon').textContent=contract().baseCoin==='BTC'?'₿':contract().baseCoin.slice(0,1);
 $('lastPrice').textContent=fmt(price);$('lastPrice').className=color(change);$('bookPrice').textContent=fmt(price);$('markPrice').textContent='Mark '+fmt(marks[symbol]);
 $('dayChange').textContent=price?`${change>=0?'+':''}${change.toFixed(2)}% (24h)`:'Waiting for price';$('dayChange').className=color(change);
 $('dayHigh').textContent=fmt(m.high24Price);$('dayLow').textContent=fmt(m.lower24Price);$('dayVolume').textContent=m.amount24?Number(m.amount24).toLocaleString('en-US',{notation:'compact',maximumFractionDigits:2}):'—';
 $('available').textContent=money(available(s,prices));$('totalEquity').textContent=money(eq);$('totalPnl').textContent=signed(upnl)+' unrealized P&L';$('totalPnl').className='equity-pnl '+color(upnl);$('walletBalance').textContent=money(s.balance);$('usedMargin').textContent=money(s.positions.reduce((n,p)=>n+p.margin,0));
 const realized=s.history.reduce((n,h)=>n+(h.net||0),0);$('realizedPnl').textContent=signed(realized);$('realizedPnl').className=color(realized);
 $('positionCount').textContent=s.positions.length;$('orderCount').textContent=s.orders.length;
 $('longButton').disabled=$('shortButton').disabled=!fresh(symbol);
 if(action==='close'){$('longButton').disabled=!fresh(symbol)||!s.positions.some(p=>p.symbol===symbol&&p.side===1);$('shortButton').disabled=!fresh(symbol)||!s.positions.some(p=>p.symbol===symbol&&p.side===-1);}
 summary();renderPositions();
}
function summary(){const value=(+$('marginAmount').value||0)*(action==='open'?leverage:1);$('positionValue').textContent=money(value)+' USDT';$('estimatedFee').textContent=money(value*FEE,4)+' USDT';}
function renderPositions(){
 const filtered=arr=>$('hidePairs').checked?arr.filter(p=>p.symbol===symbol):arr;
 const list=filtered(view==='positions'?s.positions:view==='orders'?s.orders:s.history);
 if(!list.length){$('positionList').innerHTML=`<div class="empty-state"><span class="empty-symbol">▥</span><strong>${view==='positions'?'Your next move starts here':view==='orders'?'No pending orders':'No closed trades yet'}</strong><p>${view==='positions'?'Open a paper position to put your strategy to the test.':view==='orders'?'Limit orders wait here until the market reaches your price.':'Your completed paper trades will appear here.'}</p></div>`;return;}
 $('positionList').innerHTML=list.map(p=>{
 const side=p.side===1?'Long':'Short',tag=`<span class="tag ${p.side===1?'green':'red'}">${side}</span><span class="tag">${esc(p.mode)} ${p.leverage}×</span>`,title=`<strong>${esc(p.symbol.replace('_',''))}</strong>${tag}`;
 if(view==='history')return `<article class="position-card"><div class="position-title"><div>${title}</div><b class="history-net ${color(p.net)}">${signed(p.net)} USDT</b></div><div class="position-detail">${esc(p.reason)} · Entry ${fmt(p.entry||p.price,p.symbol)} → ${fmt(p.exit,p.symbol)} · Fees ${money(p.fees,4)} USDT</div><div class="position-detail">${new Date(p.closed).toLocaleString()}</div></article>`;
 if(view==='orders')return `<article class="position-card"><div class="position-title"><div>${title}</div><button class="cancel-order" data-cancel="${p.id}">Cancel</button></div><div class="position-detail">Limit ${fmt(p.price,p.symbol)} · Margin ${money(p.margin)} USDT · ${new Date(p.created).toLocaleTimeString()}</div></article>`;
 const mark=marks[p.symbol]||p.entry,profit=pnl(p,mark),roi=profit/p.margin*100;
 return `<article class="position-card"><div class="position-title"><div>${title}</div><button class="close-position" data-close="${p.id}" ${fresh(p.symbol)?'':'disabled'}>Close position</button></div><div class="position-stats"><div><label>Unrealized P&L (USDT)</label><b class="${color(profit)}">${signed(profit)} (${roi.toFixed(2)}%)</b></div><div><label>Entry price</label><b>${fmt(p.entry,p.symbol)}</b></div><div><label>Mark price ${fresh(p.symbol)?'':'· stale'}</label><b>${fmt(mark,p.symbol)}</b></div><div><label>Margin (USDT)</label><b>${money(p.margin)}</b></div><div><label>Est. liquidation</label><b>${fmt(liquidation(p,s,marks),p.symbol)}</b></div></div><div class="position-detail">Size ${money(p.qty,6)} ${esc(p.symbol.split('_')[0])} · TP ${fmt(p.tp,p.symbol)} / SL ${fmt(p.sl,p.symbol)}</div></article>`;
 }).join('');
}
function draw(){
 const count=candles.length,span=count>1?(candles.at(-1).time-candles[0].time)/3600:0;
 const canvasEl=$('priceChart');canvasEl.dataset.candles=String(count);canvasEl.dataset.historyHours=String(span);canvasEl.dataset.interval=String(chartMinutes);
 $('chartLabel').textContent=(settings.feed==='demo'?'Simulated':'MEXC')+' · '+chartMinutes+'m';
 $('historyStatus').textContent=historyState==='error'?'History unavailable · retry':historyState==='loading'?'Loading 24h…':span>=24?'24h history':span.toFixed(1)+'h available';
 $('historyStatus').classList.toggle('history-error',historyState==='error');
 const canvas=$('priceChart'),rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,w=rect.width,h=rect.height;if(!w||!h)return;
 canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
 const left=14,right=83,top=26,bottom=28,iw=w-left-right,ih=h-top-bottom;
 ctx.strokeStyle='#20272b';ctx.lineWidth=.6;ctx.setLineDash([2,5]);for(let i=0;i<6;i++){const y=top+i*ih/5;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}for(let i=0;i<6;i++){const x=left+i*iw/5;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,h-bottom);ctx.stroke();}
 $('chartEmpty').hidden=candles.length>1;
 if(candles.length<=1)$('chartEmpty').innerHTML=historyState==='error'?'History unavailable<span>'+esc(historyError)+'</span><button id="retryHistory">Retry history</button>':'Loading 24-hour candle history<span>MEXC perpetuals · '+chartMinutes+' minute candles</span>';
 if(!count)return;
 const low=Math.min(...candles.map(c=>c.low)),high=Math.max(...candles.map(c=>c.high)),pad=Math.max((high-low)*.12,high*.0004),min=low-pad,max=high+pad;
 const slot=iw/count,x=i=>left+(i+.5)*slot,y=p=>top+(max-p)/(max-min)*ih,body=Math.max(1,Math.min(10,slot*.66));
 ctx.setLineDash([]);ctx.lineWidth=1;
 candles.forEach((c,i)=>{const cx=x(i),yo=y(c.open),yc=y(c.close);ctx.strokeStyle=ctx.fillStyle=c.close>=c.open?'#0cbd8b':'#fa4668';ctx.beginPath();ctx.moveTo(cx,y(c.high));ctx.lineTo(cx,y(c.low));ctx.stroke();ctx.fillRect(cx-body/2,Math.min(yo,yc),body,Math.max(1,Math.abs(yc-yo)));});
 ctx.font='9px "IBM Plex Mono", monospace';ctx.fillStyle='#74808a';for(let i=0;i<6;i++)ctx.fillText(fmt(max-i*(max-min)/5),w-right+10,top+i*ih/5+3);
 const last=candles.at(-1);ctx.setLineDash([3,3]);ctx.strokeStyle='#0cbd8b66';ctx.beginPath();ctx.moveTo(left,y(last.close));ctx.lineTo(w-right,y(last.close));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=last.close>=last.open?'#0cbd8b':'#fa4668';ctx.fillRect(w-right,y(last.close)-10,right,20);ctx.fillStyle='#031b13';ctx.fillText(fmt(last.close),w-right+7,y(last.close)+3);
 ctx.fillStyle='#65727c';for(let i=0;i<3;i++){const j=Math.round(i*(count-1)/2);ctx.fillText(new Date(candles[j].time*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),left+i*iw/2-(i?16:0),h-8);}
 $('chartTime').textContent=(settings.feed==='demo'?'Simulated · ':'')+chartMinutes+'m candles · '+new Date(candles[0].time*1000).toLocaleDateString()+' '+new Date(candles[0].time*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' → '+new Date(last.time*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function renderPairs(){const q=$('pairSearch').value.trim().toUpperCase();const rows=contracts.filter(c=>c.symbol.includes(q));$('pairList').innerHTML=rows.slice(0,150).map(c=>`<button class="pair-item" data-symbol="${esc(c.symbol)}"><span>${esc(c.baseCoin)}<small> / USDT</small></span><small>Perpetual ↗</small></button>`).join('')||'<p class="dialog-note">No matching contracts.</p>';$('contractCount').textContent=rows.length+' pairs';}
function selectPair(sym){symbol=sym;const max=Math.min(100,+contract().maxLeverage||100);leverage=Math.min(leverage,max);$('leverageButton').innerHTML=leverage+'× <span>▾</span>';candles=[];book([],[]);draw();$('pairDialog').close();$('limitPrice').value='';$('takeProfit').value='';$('stopLoss').value='';if(settings.feed==='demo')connect();else{loadHistory();const old=socket;if(old?.readyState===1){old.send(JSON.stringify({method:'unsub.depth.full',param:{symbol:selectPair.previous||'BTC_USDT'}}));subscribe();}render();}selectPair.previous=sym;}
async function getContracts(){
 try{const d=await fetch('./contracts.json').then(r=>r.json());contracts=d.data.filter(c=>c.quoteCoin==='USDT'&&c.state===0&&!c.isHidden);renderPairs();}catch{contracts=[{symbol:'BTC_USDT',baseCoin:'BTC',priceScale:1,contractSize:.0001,maxLeverage:100}];toast('Contract snapshot unavailable. BTC is still available.');}
 const url=marketBase()+'/api/v1/contract/detail';
 try{const r=await fetch(url,{signal:AbortSignal.timeout(7000)}),d=await r.json();if(Array.isArray(d.data)){contracts=d.data.filter(c=>c.quoteCoin==='USDT'&&c.state===0&&!c.isHidden);$('contractNote').textContent='Fresh MEXC contract list · '+new Date().toLocaleDateString();renderPairs();}}catch{/* bundled snapshot is an intentional fallback */}
}
function place(side){
 try{
 if(!fresh(symbol))throw Error('Waiting for a fresh market quote.');
 if(action==='close'){
  const matches=s.positions.filter(p=>p.symbol===symbol&&p.side===side);if(!matches.length)throw Error('No matching position to close.');
  const amount=+$('marginAmount').value;if(!Number.isFinite(amount)||amount<0)throw Error('Enter a positive close value, or leave it empty to close all.');let remaining=amount>0?amount:Infinity;
  for(const p of matches){const value=p.qty*prices[symbol],fraction=Math.min(1,remaining/value);if(fraction>0){close(s,p.id,prices[symbol],'Manual',fraction);remaining-=value*fraction;}if(remaining<=0)break;}
  save();render();toast('Paper position closed.');return;
 }
 const o={symbol,side,price:orderType==='limit'?+$('limitPrice').value:prices[symbol],margin:+$('marginAmount').value,leverage,mode:$('marginMode').value,tp:$('tpToggle').checked?(+$('takeProfit').value||null):null,sl:$('tpToggle').checked?(+$('stopLoss').value||null):null};validate(o);
 if(orderType==='limit'&&(prices[symbol]-o.price)*side>0){if(o.margin+o.margin*leverage*FEE>available(s,prices))throw Error('Insufficient available paper funds.');s.orders.push({...o,id:crypto.randomUUID(),created:Date.now()});toast('Paper limit order placed.');}
 else{open(s,{...o,price:prices[symbol]},prices);toast('Paper '+(side===1?'long':'short')+' opened.');}
 save();subscribe();render();
 }catch(e){toast(e.message);}
}
function setAction(next){action=next;$('openTab').classList.toggle('active',next==='open');$('closeTab').classList.toggle('active',next==='close');$('amountLabel').innerHTML=(next==='open'?'Margin':'Close value')+' <small>USDT</small>';$('marginAmount').value='';$('amountSlider').value=0;$('longButton').innerHTML=(next==='open'?'Open':'Close')+' Long <span>Buy / bullish ↗</span>';$('shortButton').innerHTML=(next==='open'?'Open':'Close')+' Short <span>Sell / bearish ↘</span>';$('tpToggleLabel').hidden=next==='close';$('tpFields').hidden=next==='close'||!$('tpToggle').checked;$('tradeFootnote').textContent=next==='close'?'Leave close value empty to close the full position.':'Virtual orders only. No wallet or deposit needed.';document.querySelector('.order-types').hidden=next==='close';$('limitField').hidden=next==='close'||orderType!=='limit';$('marketPriceField').hidden=next==='open'&&orderType==='limit';render();}
$('pairButton').onclick=()=>{$('pairDialog').showModal();$('pairSearch').focus();renderPairs();};$('pairSearch').oninput=renderPairs;
$('pairList').onclick=e=>{const b=e.target.closest('[data-symbol]');if(b)selectPair(b.dataset.symbol);};
document.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d=>d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
$('leverageButton').onclick=()=>{$('leverageInput').max=$('leverageSlider').max=Math.min(100,+contract().maxLeverage||100);$('leverageInput').value=$('leverageSlider').value=leverage;$('leverageDialog').showModal();};
$('leverageInput').oninput=()=>$('leverageSlider').value=$('leverageInput').value;$('leverageSlider').oninput=()=>$('leverageInput').value=$('leverageSlider').value;
document.querySelectorAll('[data-lev]').forEach(b=>b.onclick=()=>{$('leverageInput').value=$('leverageSlider').value=Math.min(+b.dataset.lev,+$('leverageInput').max);});
$('saveLeverage').onclick=()=>{const l=+$('leverageInput').value;if(!Number.isInteger(l)||l<1||l>+$('leverageInput').max){toast('Choose leverage within the allowed range.');return;}leverage=l;$('leverageButton').innerHTML=l+'× <span>▾</span>';$('leverageDialog').close();summary();};
document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{orderType=b.dataset.type;document.querySelectorAll('[data-type]').forEach(x=>x.classList.toggle('active',x===b));$('limitField').hidden=orderType!=='limit';$('marketPriceField').hidden=orderType==='limit';if(orderType==='limit'&&!$('limitPrice').value)$('limitPrice').value=prices[symbol]||'';});
$('openTab').onclick=()=>setAction('open');$('closeTab').onclick=()=>setAction('close');$('marginAmount').oninput=summary;
$('amountSlider').oninput=()=>{const fraction=+$('amountSlider').value/100,base=action==='open'?available(s,prices)/(1+leverage*FEE):s.positions.filter(p=>p.symbol===symbol).reduce((a,p)=>a+p.qty*(prices[symbol]||p.entry),0);$('marginAmount').value=(Math.floor(base*fraction*100)/100).toFixed(2);summary();};
$('tpToggle').onchange=()=>$('tpFields').hidden=!$('tpToggle').checked;
$('longButton').onclick=()=>place(1);$('shortButton').onclick=()=>place(-1);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));renderPositions();});$('hidePairs').onchange=renderPositions;
$('positionList').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.close){const p=s.positions.find(p=>p.id===b.dataset.close);if(!p||!fresh(p.symbol)){toast('Wait for a fresh price before closing.');return;}close(s,p.id,prices[p.symbol]);toast('Paper position closed.');}if(b.dataset.cancel){s.orders=s.orders.filter(o=>o.id!==b.dataset.cancel);toast('Limit order cancelled.');}save();render();};
$('settingsButton').onclick=()=>{$('feedSelect').value=settings.feed;$('proxyInput').value=settings.proxy||'';$('settingsDialog').showModal();};
$('saveSettings').onclick=()=>{const proxy=$('proxyInput').value.trim().replace(/\/$/,'');if(proxy){try{const u=new URL(proxy);if(u.protocol!=='https:'&&u.hostname!=='localhost')throw Error();}catch{toast('Enter a valid HTTPS proxy URL.');return;}}save();settings={feed:$('feedSelect').value,proxy};try{localStorage.setItem('cipher-paper-settings',JSON.stringify(settings));}catch{toast('Settings could not be saved to browser storage.');}load();$('settingsDialog').close();connect();getContracts();};
$('resetButton').onclick=()=>{if(!confirm('Reset this '+settings.feed+' paper account? Its positions, orders, and history will be removed.'))return;s=account();save();render();toast('Paper balance reset to 10,000 USDT.');};
$('exportButton').onclick=()=>{const cols=['symbol','side','entry','exit','qty','margin','leverage','mode','pnl','fees','net','reason','closed'];const csv=[cols.join(','),...s.history.map(p=>cols.map(k=>'"'+String(k==='closed'?new Date(p[k]).toISOString():p[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.href=url;a.download=`cipher-paper-${settings.feed}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('storage',e=>{if(e.key===key()||e.key==='cipher-paper-settings'){status('Account open in another tab');toast('Another tab changed this account. Reloading to keep balances consistent.');location.reload();}});
window.addEventListener('online',()=>{if(settings.feed==='live')connect();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&settings.feed==='live'&&!fresh(symbol))connect();});
document.querySelectorAll('[data-interval]').forEach(b=>b.onclick=()=>{chartMinutes=+b.dataset.interval;document.querySelectorAll('[data-interval]').forEach(x=>x.classList.toggle('active',x===b));loadHistory();});
$('historyStatus').onclick=()=>{if(historyState==='error')loadHistory();};
$('chartEmpty').onclick=e=>{if(e.target.id==='retryHistory')loadHistory();};
new ResizeObserver(draw).observe($('priceChart').parentElement);
document.querySelectorAll('.mobile-views [data-mobile-view]').forEach(b=>b.onclick=()=>{
 document.querySelector('.workspace').dataset.mobileView=b.dataset.mobileView;
 document.querySelectorAll('.mobile-views button').forEach(x=>x.setAttribute('aria-selected',String(x===b)));
 if(b.dataset.mobileView==='account')document.querySelector('[data-view="history"]').click();
 if(b.dataset.mobileView==='trade')document.querySelector('[data-view="positions"]').click();
 requestAnimationFrame(draw);
});
setInterval(()=>{if(settings.feed==='live'&&!fresh(symbol)){status('Waiting for fresh prices');$('longButton').disabled=$('shortButton').disabled=true;}},2000);
load();await getContracts();connect();
