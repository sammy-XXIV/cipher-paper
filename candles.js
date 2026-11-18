export function historyRange(minutes,now=Date.now()){
 const interval=minutes*60,end=Math.floor(now/1000);
 return {start:Math.floor((end-86400)/interval)*interval,end};
}
export function parseCandles(data){
 const byTime=new Map();
 for(let i=0;i<(data?.time?.length||0);i++){
  const c={time:+data.time[i],open:+data.open?.[i],high:+data.high?.[i],low:+data.low?.[i],close:+data.close?.[i],volume:+data.vol?.[i]||0};
  if([c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)&&c.time>0&&c.low>0&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close))byTime.set(c.time,c);
 }
 return [...byTime.values()].sort((a,b)=>a.time-b.time);
}
export function updateCandle(candles,price,minutes,now=Date.now()){
 if(!(price>0))return;const time=Math.floor(now/(minutes*60000))*minutes*60,last=candles.at(-1);
 if(last?.time===time){last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price;}
 else if(!last||last.time<time)candles.push({time,open:price,high:price,low:price,close:price,volume:0});
 const cutoff=Math.floor(now/1000)-86400-minutes*60;while(candles.length>1&&candles[0].time<cutoff)candles.shift();
}
