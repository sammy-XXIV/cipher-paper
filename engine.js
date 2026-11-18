// Linear USDT paper contracts. Fixed 0.06% fee and 0.5% maintenance margin.
export const FEE=.0006, MM=.005;
export const account=()=>({version:1,balance:10000,positions:[],orders:[],history:[]});
export const pnl=(p,price)=>(price-p.entry)*p.qty*p.side;
export const used=s=>s.positions.reduce((a,p)=>a+p.margin,0)+s.orders.reduce((a,o)=>a+o.margin+o.margin*o.leverage*FEE,0);
export const available=(s,prices={})=>Math.max(0,s.balance-used(s)+s.positions.filter(p=>p.mode==='cross').reduce((a,p)=>a+Math.min(0,pnl(p,prices[p.symbol]||p.entry)),0));
export const equity=(s,prices={})=>s.balance+s.positions.reduce((a,p)=>a+pnl(p,prices[p.symbol]||p.entry),0);
export function validate(o){
 if(!o.symbol||![1,-1].includes(o.side)||!['cross','isolated'].includes(o.mode)||![o.price,o.margin,o.leverage].every(Number.isFinite)||o.price<=0||o.margin<=0||o.leverage<1||o.leverage>100)throw Error('Enter a valid margin, price, and leverage.');
 if(o.tp && (!Number.isFinite(o.tp)||(o.tp-o.price)*o.side<=0))throw Error('Take profit must be on the profitable side of entry.');
 if(o.sl && (!Number.isFinite(o.sl)||(o.sl-o.price)*o.side>=0||o.sl<=0))throw Error('Stop loss must be on the losing side of entry.');
}
export function open(s,o,prices={}){
 validate(o);const fee=o.margin*o.leverage*FEE;
 if(o.margin+fee>available(s,prices)+1e-8)throw Error('Insufficient available paper funds. Reduce margin or cancel an order.');
 const p={id:crypto.randomUUID(),symbol:o.symbol,side:o.side,entry:o.price,qty:o.margin*o.leverage/o.price,margin:o.margin,leverage:o.leverage,mode:o.mode,tp:o.tp||null,sl:o.sl||null,opened:Date.now(),entryFee:fee};
 s.balance-=fee;s.positions.push(p);return p;
}
export function close(s,id,price,reason='Manual',fraction=1){
 const p=s.positions.find(p=>p.id===id);if(!p||!Number.isFinite(price)||price<=0||fraction<=0||fraction>1)return;
 const qty=p.qty*fraction, raw=(price-p.entry)*qty*p.side;
 let gross=p.mode==='isolated'?Math.max(-p.margin*fraction,raw):raw;
 const fee=price*qty*FEE,entryFee=p.entryFee*fraction;
 const protectedMargin=p.mode==='cross'?s.positions.filter(x=>x.mode==='isolated').reduce((a,x)=>a+x.margin,0):0;
 if(s.balance+gross-fee<protectedMargin)gross=protectedMargin-s.balance+fee;
 s.balance=Math.max(protectedMargin,s.balance+gross-fee);
 s.history.unshift({...p,qty,margin:p.margin*fraction,exit:price,pnl:gross,fees:fee+entryFee,net:gross-fee-entryFee,reason,closed:Date.now()});
 if(fraction===1)s.positions=s.positions.filter(x=>x.id!==id);
 else {p.qty-=qty;p.margin*=1-fraction;p.entryFee*=1-fraction;}
 s.history=s.history.slice(0,300);
}
export function tick(s,prices,markPrices=prices){
 let changed=false;
 for(const p of [...s.positions]){
  const price=markPrices[p.symbol];if(!price)continue;
  if(p.mode==='isolated'&&p.margin+pnl(p,price)<=p.qty*price*MM){close(s,p.id,price,'Liquidated');changed=true;}
 }
 const cross=s.positions.filter(p=>p.mode==='cross');
 if(cross.length&&cross.every(p=>markPrices[p.symbol])){
  const collateral=s.balance-s.positions.filter(p=>p.mode==='isolated').reduce((a,p)=>a+p.margin,0);
  const crossPnl=cross.reduce((a,p)=>a+pnl(p,markPrices[p.symbol]),0),maintenance=cross.reduce((a,p)=>a+p.qty*markPrices[p.symbol]*MM,0);
  if(collateral+crossPnl<=maintenance){
   // Close profits first, so clamping a loss never creates balance.
   for(const p of cross.sort((a,b)=>pnl(b,markPrices[b.symbol])-pnl(a,markPrices[a.symbol])))close(s,p.id,markPrices[p.symbol],'Liquidated');
   s.orders=[];changed=true;
  }
 }
 for(const p of [...s.positions]){
  const price=prices[p.symbol];if(!price)continue;
  const tp=p.tp&&(price-p.tp)*p.side>=0,sl=p.sl&&(price-p.sl)*p.side<=0;
  if(tp||sl){close(s,p.id,price,tp?'Take profit':'Stop loss');changed=true;}
 }
 for(const o of [...s.orders]){
  const price=prices[o.symbol];if(!price||(price-o.price)*o.side>0)continue;
  s.orders=s.orders.filter(x=>x.id!==o.id);
  try{open(s,{...o,price},prices);}catch{ s.history.unshift({...o,reason:'Order rejected: insufficient margin',closed:Date.now(),net:0,pnl:0,fees:0}); }
  changed=true;
 }
 return changed;
}
export function liquidation(p,s,prices={}){
 const cushion=p.mode==='isolated'?p.margin:s.balance-s.positions.filter(x=>x.mode==='isolated').reduce((a,x)=>a+x.margin,0)+s.positions.filter(x=>x.mode==='cross'&&x.id!==p.id).reduce((a,x)=>a+pnl(x,prices[x.symbol]||x.entry)-x.qty*(prices[x.symbol]||x.entry)*MM,0);
 return Math.max(0,(p.entry*p.qty-p.side*cushion)/(p.qty*(1-p.side*MM)));
}
