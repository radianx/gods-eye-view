import {execFileSync} from 'node:child_process';
const heads=[{"n":1,"head":"44ddb533791739a6bdad5c91e87fc83561740483"},{"n":2,"head":"85b0368854338fbc03db00a677cdc59bb46874d6"},{"n":3,"head":"fe356a61e312a3e6d11645bfc94654a9344c5390"},{"n":4,"head":"f05686af26faed1cd230c38890cf1c2de3822b7b"},{"n":5,"head":"c7dfc1985d9b3ab8c5c4ccf7c1a183531618bba5"},{"n":6,"head":"2c3f0f4f26659c233800ad156984eecd1ae60687"}];
const main='533d7c64549a2df8a3c5325940f107d36680b322';
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
for(const {n,head} of heads){
 let output;
 try{output=git(['merge-tree','--write-tree','--messages',head,main]);}
 catch(error){output=error.stdout; if(!/^[0-9a-f]{40}\n/.test(output))throw error;}
 const tree=output.split('\n')[0];
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
 console.log('OSINT_MERGE_'+n+'='+JSON.stringify({n,head,main,tree,changes,mergeOutput:output.slice(41)}));
}
