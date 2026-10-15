import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const heads=[{"n":1,"head":"44ddb533791739a6bdad5c91e87fc83561740483"},{"n":2,"head":"85b0368854338fbc03db00a677cdc59bb46874d6"},{"n":3,"head":"fe356a61e312a3e6d11645bfc94654a9344c5390"},{"n":4,"head":"f05686af26faed1cd230c38890cf1c2de3822b7b"},{"n":5,"head":"c7dfc1985d9b3ab8c5c4ccf7c1a183531618bba5"},{"n":6,"head":"2c3f0f4f26659c233800ad156984eecd1ae60687"}];
const main='533d7c64549a2df8a3c5325940f107d36680b322';
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
for(const {n,head} of heads){
 let output;
 try{output=git(['merge-tree','--write-tree','--messages',head,main]);}
 catch(error){output=error.stdout; if(!/^[0-9a-f]{40}\n/.test(output))throw error;}
 let tree=output.split('\n')[0];
 git(['read-tree','--reset','-u',tree]);
 const conflicts=new Set([...output.matchAll(/^\d{6} \w{40} [123]\t(.+)$/gm)].map(m=>m[1]));
 const marker=/^<<<<<<<[^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>>[^\n]*\n/gm;
 for(const file of conflicts){
   if(file==='scripts/format-scope.json'){
     const upstream=JSON.parse(git(['show',main+':'+file]));
     const feature=JSON.parse(git(['show',head+':'+file]));
     fs.writeFileSync(file,JSON.stringify([...new Set([...upstream,...feature])],null,2)+'\n');
   }else if(n===2 && file==='docs/CURRENT-STATE.md'){
     const content=fs.readFileSync(file,'utf8').replace(marker,(_all,ours,theirs)=>{
       const row=ours.split('\n').find(line=>line.startsWith('| Fire Perimeters'));
       const paragraph=ours.split('\n').find(line=>line.startsWith('Fire Perimeters fetches'));
       if(!row || !paragraph)throw new Error('Unexpected fire documentation conflict');
       return theirs.replace(/^\| Fire Perimeters[^\n]*$/m,row)
         .replace(/^Fire Perimeters uses capped[^\n]*$/m,paragraph);
     });
     fs.writeFileSync(file,content);
   }else if(n===2 && ['src/firstRunExperience.test.mjs','src/voice/actionSchemas.test.mjs'].includes(file)){
     fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(marker,(_all,_ours,theirs)=>theirs));
   }else throw new Error('Unreviewed conflict in '+file);
 }
 if(n===2){
   const {GEV_REALTIME_TOOLS}=await import(pathToFileURL(path.resolve('server/providers/openai/tools.js')));
   const stable=(value)=>Array.isArray(value)?value.map(stable):value && typeof value==='object'
     ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,stable(child)])):value;
   const tools=GEV_REALTIME_TOOLS.filter(tool=>tool.name!=='set_cyber_sonar');
   const digest=createHash('sha256').update(JSON.stringify(stable(tools))).digest('hex');
   const legacy=structuredClone(tools);
   const hud=legacy.find(tool=>tool.name==='set_hud').parameters.properties.layout;
   hud.enum=hud.enum.filter(layout=>layout!=='cyber');
   const block=JSON.stringify(legacy);
   const legacyDigest=createHash('sha256').update(block).digest('hex');
   const first='src/firstRunExperience.test.mjs';
   fs.writeFileSync(first,fs.readFileSync(first,'utf8')
     .replace('assert.equal(block.length, 30511,','assert.equal(block.length, '+block.length+',')
     .replace('62d5df9cedf413403e4fd0a7cbe94bb2cd13736c3d8fedc84bcccd63ad253eb6',legacyDigest)
     .replace('// Street Level and GNSS extend the manifest;', '// Street Level, GNSS and INFONA extend the manifest;'));
   const schema='src/voice/actionSchemas.test.mjs';
   fs.writeFileSync(schema,fs.readFileSync(schema,'utf8')
     .replace('9398815a573ab29ecc3ce527f6e1a2ad883804e7696e0444aebb11f973700d4b',digest)
     .replace('// Street Level and GNSS extend the manifest;', '// Street Level, GNSS and INFONA extend the manifest;'));
   console.log('Updated reviewed schema pins: '+JSON.stringify({length:block.length,legacyDigest,digest}));
 }
 for(const file of conflicts)if(/^<<<<<<<|^=======|^>>>>>>>/m.test(fs.readFileSync(file,'utf8')))throw new Error('Unresolved conflict '+file);
 git(['add','--all']);
 tree=git(['write-tree']).trim();
 const known=new Set();
 for(const ref of [head,main])for(const row of git(['ls-tree','-r',ref]).trimEnd().split('\n'))known.add(row.split('\t')[0].split(' ')[2]);
 const paths=git(['diff','--name-only',main,tree]).trimEnd().split('\n').filter(Boolean);
 const entries=new Map(git(['ls-tree','-r',tree]).trimEnd().split('\n').map(row=>{
   const [prefix,path]=row.split('\t');const[mode,type,sha]=prefix.split(' ');return[path,{path,mode,type,sha}];
 }));
 const changes=paths.map(path=>{
   const entry=entries.get(path);
   if(!entry)return {path,mode:'100644',type:'blob',sha:null};
   if(!known.has(entry.sha))entry.patch=git(['diff','--no-color',main,tree,'--',path]);
   return entry;
 });
 console.log('OSINT_RESOLVED_'+n+'='+JSON.stringify({n,head,main,tree,changes,mergeOutput:output.slice(41)}));
}
