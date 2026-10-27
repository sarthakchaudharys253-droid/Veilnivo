import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source='https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt';
const sourceSha256='1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda';
const categories=[
 ['smileys','Smileys & Emotion','😀'],['people','People & Body','👋'],
 ['animals','Animals & Nature','🐻'],['food','Food & Drink','🍎'],
 ['travel','Travel & Places','🚗'],['activities','Activities','⚽'],
 ['objects','Objects','💡'],['symbols','Symbols','❤️'],['flags','Flags','🏁'],
];

async function download(url){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Unicode download failed: HTTP ${response.status}`);return response.text()}
const cached=process.argv.includes('--from-cache');
const [text,license]=cached?
 await Promise.all(['emoji-test.txt','UNICODE-LICENSE.txt'].map(file=>readFile(path.join(root,'.local','emoji-catalog',file),'utf8'))):
 await Promise.all([download(source),download('https://www.unicode.org/license.txt')]);
if(createHash('sha256').update(text).digest('hex')!==sourceSha256)throw new Error('Pinned Unicode17 data checksum mismatch; no files written.');
if(!text.includes('# Version: 17.0')||!license.startsWith('UNICODE LICENSE V3'))throw new Error('Unexpected Unicode data or license.');
const rows=[];
let category;
for(const line of text.split(/\r?\n/)){
 const group=/^# group: (.+)$/.exec(line);
 if(group){category=categories.find(row=>row[1]===group[1])?.[0];continue}
 const record=/^([0-9A-F ]+)\s*;\s*fully-qualified\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/.exec(line);
 if(!record)continue;
 if(!category)throw new Error('Fully qualified emoji without a known category.');
 const emoji=String.fromCodePoint(...record[1].trim().split(/\s+/).map(value=>parseInt(value,16)));
 if(emoji!==record[2])throw new Error('Unicode sequence/name mismatch.');
 rows.push([emoji,record[3],category]);
}
if(rows.length!==3944||new Set(rows.map(row=>row[0])).size!==3944)throw new Error('Incomplete or duplicate Unicode17 emoji catalog.');
const data={version:'17.0',source,sourceSha256,license:'Unicode License V3; see public/unicode-license.txt',categories,rows};
await mkdir(path.join(root,'public'),{recursive:true});
await writeFile(path.join(root,'src','lib','emoji-data.json'),JSON.stringify(data)+'\n','utf8');
await writeFile(path.join(root,'public','unicode-license.txt'),license,'utf8');
await writeFile(path.join(root,'public','emoji-attribution.txt'),`Emoji character sequences and names: Unicode Emoji17.0\n${source}\nSource SHA-256: ${sourceSha256}\nCopyright © 2025 Unicode, Inc.\nRedistributed under Unicode License V3. See unicode-license.txt.\n\nVeilnivo uses your device's native emoji font. No Apple emoji artwork or fonts are distributed with this application. Appearance and support for newer sequences depend on your device.\n`,'utf8');
console.log(`Generated ${rows.length} fully qualified Emoji17.0 sequences in ${categories.length} categories.`);
