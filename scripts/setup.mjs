// Run locally after npm install. Never commit the generated secrets.json.
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {passwordHash} from '../src/security.js';
import push from 'web-push';
let hidden=false;const output=new Writable({write(chunk,encoding,callback){if(!hidden)process.stdout.write(chunk);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:true});
const users=[];
try{
 for(let i=1;i<=2;i++){
  const name=(await rl.question(`Partner ${i} name: `)).trim();
  const email=(await rl.question('Login email: ')).trim().toLowerCase();
  process.stdout.write('Password (at least 14 characters, input hidden): ');hidden=true;const password=await rl.question('');hidden=false;process.stdout.write('\n');
  if(!name||!email.includes('@')||password.length<14)throw new Error('Name, valid email and a password of at least 14 characters required.');
  if(users.some(u=>u.email===email))throw new Error('Each partner must use a different email.');
  const phone=(await rl.question('Mobile number for opted-in team alerts (+1..., blank to skip): ')).trim();
  if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Use international phone format.');
  const consent=phone?(await rl.question('Does this partner agree to receive job-lead text alerts? Type yes: ')).trim().toLowerCase():'';
  const salt=randomBytes(24).toString('hex');users.push({id:`partner-${i}`,name,email,salt,hash:await passwordHash(password,salt),phone,smsEnabled:consent==='yes'});
 }
 const subject=(await rl.question('Business email for push delivery contact: ')).trim();if(!subject.includes('@'))throw new Error('A valid contact email is required.');
 const keys=push.generateVAPIDKeys();
 const secrets={TEAM_USERS_JSON:JSON.stringify(users),SESSION_SECRET:randomBytes(48).toString('hex'),VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:'+subject,APP_ORIGIN:'https://app.lukesgood.com'};
 await writeFile(new URL('../secrets.json',import.meta.url),JSON.stringify(secrets,null,2),{flag:'wx',mode:0o600});
 console.log('Created ignored secrets.json. Upload with: npx wrangler secret bulk secrets.json. Keep it private; do not commit or share it.');
}finally{rl.close();}
