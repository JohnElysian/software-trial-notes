import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

export class MemoryStore {
  constructor(data={requests:{},events:{},reminders:{}}){this.data=structuredClone(data);}
  async read(){return structuredClone(this.data);}
  async write(data){this.data=structuredClone(data);}
}

// One process/runner at a time. A real multi-worker n8n deployment needs a
// transactional shared store and a distributed lock/unique-key constraint.
export class JsonFileStore {
  constructor(path){this.path=path;}
  async read(){
    try{return JSON.parse(await readFile(this.path,'utf8'));}
    catch(error){if(error.code==='ENOENT')return {requests:{},events:{},reminders:{}};throw error;}
  }
  async write(data){
    await mkdir(dirname(this.path),{recursive:true});
    const temp=this.path+'.pending';
    await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});
    await rename(temp,this.path);
  }
}
