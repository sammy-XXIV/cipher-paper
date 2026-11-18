const s=new WebSocket('wss://contract.mexc.com/edge');let n=0;
s.onopen=()=>{console.log('OPEN');s.send(JSON.stringify({method:'sub.ticker',param:{symbol:'BTC_USDT'}}));s.send(JSON.stringify({method:'sub.depth.full',param:{symbol:'BTC_USDT',limit:20}}));};
s.onmessage=e=>{console.log(String(e.data).slice(0,1300));if(++n>5)s.close();};s.onerror=e=>console.log('ERROR',e.message);setTimeout(()=>{s.close();process.exit();},15000);
