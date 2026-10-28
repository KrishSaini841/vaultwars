import {zipFunctions} from '@netlify/zip-it-and-ship-it';
import {mkdir,rm,writeFile} from 'node:fs/promises';
await rm('packaged-functions',{recursive:true,force:true});
await mkdir('packaged-functions',{recursive:true});
const functions=await zipFunctions('netlify/functions','packaged-functions',{config:{'*':{nodeBundler:'esbuild',nodeVersion:'22'}},basePath:process.cwd()});
if(functions.length!==1||functions[0].name!=='game')throw Error('Expected exactly one game function.');
await writeFile('packaged-functions/verification.json',JSON.stringify(functions.map(({name,runtime,mainFile,inputs})=>({name,runtime,entry:mainFile?.replace(process.cwd()+'/',''),inputCount:inputs?.length})),null,2));
console.log('Packaged standard Netlify function: game');
