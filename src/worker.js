import {equal,hmac,passwordHash,makeSession,readSession,validPushEndpoint} from './security.js';
const statuses=['New','Contacted','Quoted','Booked','Completed','Lost'];
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const text=(v,max=2000)=>String(v??'').trim().slice(0,max);
const team=env=>JSON.parse(env.TEAM_USERS_JSON||'[]');
function publicUser(u){return {id:u.id,name:u.name};}
async function body(req){if(Number(req.headers.get('content-length'))>24000)throw new Error('Request too large'); const value=await req.text();if(value.length>24000)throw new Error('Request too large');return JSON.parse(value);}
async function createLead(env,data,source,sourceId=null){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const insert=env.DB.prepare('INSERT OR IGNORE INTO leads (id,source_id,name,phone,zip,services,timing,source,ad_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,sourceId,text(data.name,120),text(data.phone,40),text(data.zip,20),text(data.services,500),text(data.timing,100),source,text(data.ad_id,100),now,now);
 const subscriptions=await env.DB.prepare('SELECT endpoint FROM subscriptions').all();
 const tasks=[];
 for(const s of subscriptions.results)tasks.push(['push',s.endpoint]);
 for(const u of team(env))if(u.phone&&u.smsEnabled===true)tasks.push(['sms',u.phone]);
 const result=await env.DB.batch([insert,...tasks.map(([channel,target])=>env.DB.prepare('INSERT INTO notifications (id,lead_id,channel,target,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM leads WHERE id=?)').bind(crypto.randomUUID(),id,channel,target,now,id))]);
 if(!result[0].meta.changes)return null;
 return id;
}
export async function deliver(env){
 const {results}=await env.DB.prepare("SELECT n.*,l.name,l.services FROM notifications n JOIN leads l ON l.id=n.lead_id WHERE n.state='pending' AND n.attempts<5 LIMIT 30").all();
 for(const n of results){
  if(n.channel==='sms'&&!(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM))continue;
  if(n.channel==='push'&&!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT))continue;
  // Atomic claim prevents concurrent cron/request handlers sending the same alert.
  const claim=await env.DB.prepare("UPDATE notifications SET state='sending',attempts=attempts+1 WHERE id=? AND state='pending'").bind(n.id).run();if(!claim.meta.changes)continue;
  try{
   const message=`New Luke's Good lead: ${n.name} — ${n.services||'Estimate request'}. ${env.APP_ORIGIN||'https://app.lukesgood.com'}/?lead=${n.lead_id}`;
   if(n.channel==='sms'){
    const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:n.target,From:env.TWILIO_FROM,Body:message}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('SMS provider HTTP '+response.status);
   }else{
    const sub=await env.DB.prepare('SELECT data FROM subscriptions WHERE endpoint=?').bind(n.target).first();
    if(sub){const module=await import('web-push');const push=module.default;push.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);await push.sendNotification(JSON.parse(sub.data),JSON.stringify({title:'New estimate request',body:n.name+' · '+n.services,url:'/?lead='+n.lead_id}),{TTL:3600,timeout:15000});}
   }
   await env.DB.prepare("UPDATE notifications SET state='sent',last_error=NULL WHERE id=?").bind(n.id).run();
  }catch(error){
   if(error.statusCode===410||error.statusCode===404){await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(n.target).run();await env.DB.prepare("UPDATE notifications SET state='expired' WHERE id=?").bind(n.id).run();}
   else await env.DB.prepare("UPDATE notifications SET state=?,last_error=? WHERE id=?").bind(n.attempts+1>=5?'failed':'pending',text(error.message,160),n.id).run();
  }
 }
}
async function webhook(req,env,ctx){
 const url=new URL(req.url);
 if(req.method==='GET')return env.META_VERIFY_TOKEN&&equal(url.searchParams.get('hub.verify_token'),env.META_VERIFY_TOKEN)&&url.searchParams.get('hub.mode')==='subscribe'?new Response(url.searchParams.get('hub.challenge')):json({error:'Verification failed'},403);
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(!(env.META_APP_SECRET&&env.META_PAGE_TOKEN&&env.META_PAGE_ID&&env.META_GRAPH_VERSION))return json({error:'Meta is not configured'},503);
 const raw=await req.text();if(raw.length>100000)return json({error:'Payload too large'},413);
 if(!equal(req.headers.get('x-hub-signature-256'),'sha256='+await hmac(env.META_APP_SECRET,raw)))return json({error:'Invalid signature'},403);
 const event=JSON.parse(raw);let receivedNew=false;
 if(event.object!=='page')return json({received:true});
 for(const entry of event.entry||[]){
  if(String(entry.id)!==String(env.META_PAGE_ID))continue;
  for(const change of entry.changes||[]){if(change.field!=='leadgen')continue;
   const id=String(change.value?.leadgen_id||'');if(!/^\d+$/.test(id))continue;
   const existing=await env.DB.prepare('SELECT id FROM leads WHERE source_id=?').bind(id).first();if(existing)continue;
   const response=await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${id}?fields=field_data,ad_id`,{headers:{Authorization:'Bearer '+env.META_PAGE_TOKEN},signal:AbortSignal.timeout(15000)});
   if(!response.ok)return json({error:'Lead retrieval failed; retry required'},502);
   const lead=await response.json(),fields=Object.fromEntries((lead.field_data||[]).map(f=>[f.name,(f.values||[]).join(', ')]));
   const inserted=await createLead(env,{name:fields.full_name||[fields.first_name,fields.last_name].filter(Boolean).join(' ')||'New customer',phone:fields.phone_number||'',zip:fields.zip_code||fields.post_code||'',services:fields.services_needed||fields.services||'',timing:fields.desired_timing||'',ad_id:lead.ad_id},'Meta',id);if(inserted)receivedNew=true;
  }
 }
 if(receivedNew)ctx.waitUntil(deliver(env));return json({received:true});
}
async function api(req,env,ctx){
 const url=new URL(req.url),path=url.pathname;
 if(path==='/api/meta/webhook')return webhook(req,env,ctx);
 if(!env.SESSION_SECRET||team(env).length<1)return json({error:'Team login has not been configured yet.'},503);
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 if(path==='/api/login'&&req.method==='POST'){
  const ip=req.headers.get('CF-Connecting-IP')||'local',key=await hmac(env.SESSION_SECRET,ip),now=Date.now();
  await env.DB.prepare('DELETE FROM login_attempts WHERE expires<?').bind(now).run();
  await env.DB.prepare('INSERT INTO login_attempts (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(key,now+900000).run();
  const limit=await env.DB.prepare('SELECT count FROM login_attempts WHERE key=?').bind(key).first();
  if(limit.count>10)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
  const data=await body(req),u=team(env).find(u=>u.email.toLowerCase()===text(data.email,180).toLowerCase());
  const hashed=await passwordHash(text(data.password,256),u?.salt||'invalid-user-salt');
  if(!u||!equal(hashed,u.hash))return json({error:'Email or password is incorrect.'},401);
  return json({user:publicUser(u)},200,{'Set-Cookie':`session=${await makeSession(u.id,env.SESSION_SECRET)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`});
 }
 const token=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('session='))?.slice(8)||'';
 const session=await readSession(token,env.SESSION_SECRET),user=team(env).find(u=>u.id===session?.id);
 if(!user)return json({error:'Please sign in.'},401);
 if(path==='/api/logout'&&req.method==='POST')return json({ok:true},200,{'Set-Cookie':'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
 if(path==='/api/me'&&req.method==='GET')return json({user:publicUser(user),team:team(env).map(publicUser),pushKey:env.VAPID_PUBLIC_KEY||null,integrations:{meta:!!(env.META_APP_SECRET&&env.META_PAGE_TOKEN&&env.META_PAGE_ID&&env.META_GRAPH_VERSION),push:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT),sms:!!(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM)}});
 if(path==='/api/leads'&&req.method==='GET'){const leads=await env.DB.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 1000').all();return json(leads.results);}
 if(path==='/api/leads'&&req.method==='POST'){
  const data=await body(req);if(!text(data.name,120)||!/[0-9]{7}/.test(text(data.phone,40).replace(/\D/g,'')))return json({error:'Enter a name and valid phone number.'},400);
  const id=await createLead(env,data,'Manual');ctx.waitUntil(deliver(env));return json({id},201);
 }
 if(path.startsWith('/api/leads/')&&req.method==='PATCH'){
  const id=decodeURIComponent(path.slice(11)),data=await body(req);
  if(!statuses.includes(data.status)||!(data.assignee===''||team(env).some(u=>u.id===data.assignee)))return json({error:'Invalid status or assignment'},400);
  const result=await env.DB.prepare('UPDATE leads SET status=?,assignee=?,notes=?,updated_at=? WHERE id=? AND updated_at=?').bind(data.status,data.assignee,text(data.notes,8000),new Date().toISOString(),id,data.updated_at).run();
  if(!result.meta.changes)return json({error:'This lead changed on another device. Reload it before saving.'},409);
  return json({ok:true});
 }
 if(path==='/api/push'&&req.method==='POST'){
  const sub=await body(req);if(!validPushEndpoint(sub.endpoint)||!sub.keys?.auth||!sub.keys?.p256dh)return json({error:'Invalid push subscription'},400);
  await env.DB.prepare('INSERT INTO subscriptions(endpoint,user_id,data) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,data=excluded.data').bind(sub.endpoint,user.id,JSON.stringify(sub)).run();return json({ok:true});
 }
 if(path==='/api/notifications'&&req.method==='GET')return json((await env.DB.prepare('SELECT channel,state,attempts,last_error,created_at FROM notifications ORDER BY created_at DESC LIMIT 30').all()).results);
 return json({error:'Not found'},404);
}
export default {
 async fetch(req,env,ctx){try{
  const path=new URL(req.url).pathname;
  const response=path.startsWith('/api/')?await api(req,env,ctx):await env.ASSETS.fetch(req);
  const secured=new Response(response.body,response);secured.headers.set('X-Content-Type-Options','nosniff');secured.headers.set('Referrer-Policy','same-origin');secured.headers.set('X-Frame-Options','DENY');secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");return secured;
 }catch(error){console.error('Request failed',error.name);return json({error:'Request failed. Please try again.'},500);}},
 async scheduled(event,env,ctx){ctx.waitUntil(deliver(env));}
};
