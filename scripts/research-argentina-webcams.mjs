import fs from 'node:fs/promises';
await fs.mkdir('qa-artifacts/webcams',{recursive:true});
const query='[out:json][timeout:25];(nwr["name"~"Princesa|Catalina|Cable|Diente|Eventos|Playpark",i](-41.20,-71.52,-41.14,-71.42);nwr["name"~"Mocho|Rancho|Lift|Puente|Puma",i](-40.25,-71.39,-40.17,-71.30);nwr["name"~"Plateau|Hoya|Principiante|Base",i](-42.90,-71.30,-42.78,-71.20);nwr["name"~"Guardalavaca|Patagonia|Dufaur|Faro Recalada|Pedro de Mendoza",i](-39.01,-61.31,-38.96,-61.24););out center;';
for(const host of ['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter']){
try{
const r=await fetch(host+'?data='+encodeURIComponent(query),{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'GodsEyeViewContribution/1.0 (+https://github.com/radianx/gods-eye-view)'}});
const text=await r.text();
console.log('OSM_STATUS '+JSON.stringify({host,status:r.status,body:text.slice(0,180)}));
if(!r.ok)continue;
const json=JSON.parse(text);await fs.writeFile('qa-artifacts/webcams/osm.json',JSON.stringify(json,null,2));
console.log('OSM '+JSON.stringify(json.elements?.map(e=>({type:e.type,id:e.id,lat:e.lat,lon:e.lon,center:e.center,tags:e.tags}))));
break;
}catch(e){console.log('OSM_ERROR '+e.message);}
}
