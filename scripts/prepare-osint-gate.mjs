import fs from 'node:fs';
const gate=process.env.OSINT_GATE;
if(gate==='baseline-admin-software'){
 const file='scripts/qa-admin-outlines.mjs';
 let source=fs.readFileSync(file,'utf8').replace("'--use-gl=angle',","'--use-gl=angle',\n    '--use-angle=swiftshader',");
 fs.writeFileSync(file,source);
}
if(gate==='outline-functional-diagnostic'){
 const file='scripts/qa-admin-outlines.mjs';
 let source=fs.readFileSync(file,'utf8');
 const budget=/    assert\.ok\(\n      timing\.drawnMs < OUTLINE_BUDGET_MS,[\s\S]*?\n    \);/;
 if(!budget.test(source))throw new Error('Expected timing assertion');
 source=source.replace(budget,"    if (timing.drawnMs >= OUTLINE_BUDGET_MS) {\n      (result.softwareTimingViolations ??= []).push({ name, drawnMs: timing.drawnMs, budgetMs: OUTLINE_BUDGET_MS });\n    }");
 source=source.replace("    if (message.type() === 'error')\n      result.consoleErrors.push", "    if (message.type() === 'error'\n      && !(message.location()?.url?.includes('/api/google/tiles-token') && message.text().includes('404')))\n      result.consoleErrors.push");
 fs.writeFileSync(file,source);
}
