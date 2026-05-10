import { readFileSync } from 'node:fs';
const t = readFileSync('src/data/game.ts','utf8');
const factories = JSON.parse(t.match(/FACTORIES: Record<number, Factory> = (\{[\s\S]*?\n\});/)[1]);
const products = JSON.parse(t.match(/PRODUCTS: Record<number, Product> = (\{[\s\S]*?\n\});/)[1]);
const fertilities = JSON.parse(t.match(/FERTILITIES: Record<number, Fertility> = (\{[\s\S]*?\n\});/)[1]);
console.log('factories:', Object.keys(factories).length);
console.log('products:', Object.keys(products).length);
console.log('fertilities:', Object.keys(fertilities).length);

const byTier = {};
for (const f of Object.values(factories)) {
  const k = f.workforceTier || '(none)';
  byTier[k] = (byTier[k]||0)+1;
}
console.log('factories by workforceTier:', byTier);

const byRegion = {};
for (const f of Object.values(factories)) {
  const k = (f.regions||[]).join(',') || '(none)';
  byRegion[k] = (byRegion[k]||0)+1;
}
console.log('factories by region:', byRegion);

// Multi-producer goods
const byOutput = {};
for (const f of Object.values(factories)) for (const o of f.outputs) (byOutput[o.product] ??= []).push(f);
const multi = Object.entries(byOutput).filter(([_,fs])=>fs.length>1);
console.log('\nproducts with multiple producing factories:', multi.length);
for (const [p, fs] of multi) {
  console.log('  '+products[p].name+': '+fs.map(f=>`${f.name} (${f.regions.join(',')}, ${f.cycleTime}s)`).join(' | '));
}

// Fertility usage
const fUsed = new Set();
for (const f of Object.values(factories)) if (f.fertility) fUsed.add(f.fertility);
console.log('\nfertilities actually used by factories:', fUsed.size);
for (const id of fUsed) console.log('  '+fertilities[id].name+' ['+fertilities[id].regions.join(',')+']');
