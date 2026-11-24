import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {makeSession,hmac} from '../src/security.js';
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async run(){return this.execute();},execute(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};return {sqlite,DB};}
test('partners share leads; stale edits cannot overwrite notes',async()=>{const {sqlite,DB}=database();try{const env={DB,SESSION_SECRET:'test',TEAM_USERS_JSON:JSON.stringify([{id:'p1',name:'One'},{id:'p2',name:'Two'}])};const pending=[];const ctx={waitUntil(p){pending.push(p);}};const request=async(path,method,user,data)=>worker.fetch(new Request('https://example.test/api/'+path,{method,headers:{Origin:'https://example.test',Cookie:'session='+await makeSession(user,'test')},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
 const added=await request('leads','POST','p1',{name:'Test customer',phone:'7705550123',services:'Driveway cleaning'});assert.equal(added.status,201);const id=(await added.json()).id;await Promise.all(pending);
 const list=await (await request('leads','GET','p2')).json();assert.equal(list.length,1);assert.equal(list[0].name,'Test customer');
 const change={status:'Contacted',assignee:'p2',notes:'Called; quote tomorrow.',updated_at:list[0].updated_at};assert.equal((await request('leads/'+id,'PATCH','p2',change)).status,200);
 assert.equal((await request('leads/'+id,'PATCH','p1',{...change,notes:'stale note'})).status,409);
 const updated=await (await request('leads','GET','p1')).json();assert.equal(updated[0].notes,'Called; quote tomorrow.');assert.equal(updated[0].assignee,'p2');
 assert.equal((await request('leads/'+id,'PATCH','p1',{...change,assignee:'outsider'})).status,400);
 }finally{sqlite.close();}});
test('duplicate signed Meta deliveries save one lead and one SMS job',async()=>{const {sqlite,DB}=database();const originalFetch=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({field_data:[{name:'full_name',values:['Meta customer']},{name:'phone_number',values:['7705550123']},{name:'services_needed',values:['Roof cleaning']}],ad_id:'123'});const env={DB,TEAM_USERS_JSON:JSON.stringify([{id:'p1',name:'One',phone:'+17705550123',smsEnabled:true}]),META_APP_SECRET:'secret',META_PAGE_TOKEN:'token',META_PAGE_ID:'1',META_GRAPH_VERSION:'v-test'};const raw=JSON.stringify({object:'page',entry:[{id:'1',changes:[{field:'leadgen',value:{leadgen_id:'456'}}]}]});const signature='sha256='+await hmac('secret',raw);const pending=[],ctx={waitUntil(p){pending.push(p);}};
 for(let i=0;i<2;i++){const response=await worker.fetch(new Request('https://example.test/api/meta/webhook',{method:'POST',headers:{'x-hub-signature-256':signature},body:raw}),env,ctx);assert.equal(response.status,200);await Promise.all(pending);}
 assert.equal(sqlite.prepare('SELECT count(*) AS total FROM leads').get().total,1);assert.equal(sqlite.prepare('SELECT count(*) AS total FROM notifications').get().total,1);assert.equal(sqlite.prepare('SELECT state FROM notifications').get().state,'pending');
 }finally{globalThis.fetch=originalFetch;sqlite.close();}});
