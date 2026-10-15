import fs from 'node:fs';
if(process.env.OSINT_GATE === 'admin-swiftshader') {
 const file='scripts/qa-admin-outlines.mjs';
 let source=fs.readFileSync(file,'utf8');
 if(!source.includes("'--use-gl=angle',"))throw new Error('Expected ANGLE flag');
 source=source.replace("'--use-gl=angle',","'--use-gl=angle',\n    ...(process.platform === 'linux' ? ['--use-angle=swiftshader'] : []),");
 fs.writeFileSync(file,source);
}
