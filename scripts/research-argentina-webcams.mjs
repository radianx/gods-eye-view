import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await fs.mkdir('qa-artifacts/webcams', {recursive:true});
const results=[];
for(const url of [
'https://live.noticiasmontehermoso.com.ar/camara1/index.m3u8',
'https://live.noticiasmontehermoso.com.ar/camara2/index.m3u8',
'https://encoder-1b.montevision.com.ar/live/monte2.m3u8'
]){
 const item={url,hops:[]};results.push(item); let current=url;
 try{
 for(let i=0;i<4;i++){
 const r=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(15000)});
 const body=await r.text();item.hops.push({url:current,status:r.status,location:r.headers.get('location'),cors:r.headers.get('access-control-allow-origin'),body:body.slice(0,4500)});
 if(r.status>=300&&r.status<400&&r.headers.get('location')) {current=new URL(r.headers.get('location'),current).href;continue;}break;
 }
 }catch(e){item.error=e.message;}
 try{
 const out=execFileSync('ffprobe',['-v','error','-rw_timeout','15000000','-show_entries','stream=codec_name,width,height,codec_type','-of','json',url],{timeout:25000,maxBuffer:100000,encoding:'utf8'});
 item.ffprobe=JSON.parse(out);
 }catch(e){item.ffprobeError=String(e.stderr||e.message).slice(0,500);}
 console.log('HLS_CHECK '+JSON.stringify(item));
}
const query='[out:json][timeout:25];(nwr["name"~"Princesa|Catalina|Cable|Diente|Eventos|Playpark",i](-41.20,-71.52,-41.14,-71.42);nwr["name"~"Mocho|Rancho|Lift|Puente|Puma",i](-40.25,-71.39,-40.17,-71.30);nwr["name"~"Plateau|Hoya|Principiante|Base",i](-42.90,-71.30,-42.78,-71.20);nwr["name"~"Guardalavaca|Patagonia|Dufaur|Faro Recalada|Pedro de Mendoza",i](-39.01,-61.31,-38.96,-61.24););out center;';
try{
const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(45000),headers:{'User-Agent':'gods-eye-view-contribution-research/1.0'}});
const json=await r.json();await fs.writeFile('qa-artifacts/webcams/osm.json',JSON.stringify(json,null,2));
console.log('OSM '+JSON.stringify({status:r.status,elements:json.elements?.map(e=>({type:e.type,id:e.id,lat:e.lat,lon:e.lon,center:e.center,tags:e.tags}))}));
}catch(e){console.log('OSM_ERROR '+e.message);}
await fs.writeFile('qa-artifacts/webcams/hls-report.json',JSON.stringify(results,null,2));
