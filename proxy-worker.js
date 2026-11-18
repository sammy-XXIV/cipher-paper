// Optional Cloudflare Worker. No credentials or trading endpoints.
export default {async fetch(request){
 const input=new URL(request.url),path=input.pathname;
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json'};
 if(request.method==='OPTIONS')return new Response(null,{headers});
 const kline=/^\/api\/v1\/contract\/kline\/[A-Z0-9_]{2,40}_USDT$/.test(path);
 if(request.method!=='GET'||(!kline&&!['/api/v1/contract/detail','/api/v1/contract/ticker'].includes(path)))return new Response('{"error":"Not found"}',{status:404,headers});
 const upstream=new URL('https://contract.mexc.com'+path);
 if(kline){
  const interval=input.searchParams.get('interval')||'Min15',start=Number(input.searchParams.get('start')),end=Number(input.searchParams.get('end'));
  if(!['Min5','Min15','Min60'].includes(interval)||!Number.isInteger(start)||!Number.isInteger(end)||start<=0||end<=start||end-start>90000)return new Response('{"error":"Invalid candle range"}',{status:400,headers});
  upstream.searchParams.set('interval',interval);upstream.searchParams.set('start',String(start));upstream.searchParams.set('end',String(end));
 }
 try{const response=await fetch(upstream,{signal:AbortSignal.timeout(10000)});return new Response(response.body,{status:response.status,headers:{...headers,'Cache-Control':'public, max-age=30'}});}catch{return new Response('{"error":"MEXC unavailable"}',{status:502,headers});}
}};
