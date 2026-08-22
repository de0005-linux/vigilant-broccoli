import WebSocket from 'ws';
const base='http://127.0.0.1:3244',token='test-railway-browser-token-123456';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});if(!login.ok)throw Error('login failed '+login.status);const cookie=login.headers.get('set-cookie').split(';')[0];
const messages=[];const ws=new WebSocket('ws://127.0.0.1:3244/ws',{headers:{Cookie:cookie}});ws.on('message',d=>{try{messages.push(JSON.parse(d.toString()))}catch{}});await new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject)});
async function waitFor(fn,label,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){const v=fn();if(v)return v;await sleep(100)}throw Error('timeout: '+label)}
const first=await waitFor(()=>messages.find(m=>m.type==='state'&&m.ready&&m.tabs?.length>=1),'initial state',25000);const firstId=first.activeId;await waitFor(()=>messages.find(m=>m.type==='frame'&&m.tabId===firstId),'initial frame');
ws.send(JSON.stringify({type:'tab.new',url:'http://127.0.0.1:3344/page2'}));const two=await waitFor(()=>[...messages].reverse().find(m=>m.type==='state'&&m.tabs?.length>=2&&m.tabs.some(t=>t.url.includes('/page2'))),'second tab');const secondId=two.activeId;if(secondId===firstId)throw Error('new tab not active');
ws.send(JSON.stringify({type:'tab.activate',id:firstId}));await waitFor(()=>[...messages].reverse().find(m=>m.type==='state'&&m.activeId===firstId),'tab activation');
ws.send(JSON.stringify({type:'navigate',url:'http://127.0.0.1:3344/download'}));const stored=await waitFor(()=>messages.find(m=>m.type==='download:update'&&m.download?.status==='stored'),'download stored',20000);if(stored.download.location!=='local'||stored.download.name!=='test-download.txt')throw Error('download metadata invalid');
const list=await fetch(base+'/api/downloads',{headers:{Cookie:cookie}}).then(r=>r.json());if(!list.items.some(x=>x.id===stored.download.id&&x.size>0))throw Error('download missing from API');
const access=await fetch(base+'/api/downloads/'+stored.download.id+'/url',{method:'POST',headers:{Cookie:cookie,'content-type':'application/json'},body:'{}'}).then(r=>r.json());const body=await fetch(base+access.url,{headers:{Cookie:cookie}}).then(r=>r.text());if(body!=='railway-browser-download-ok\n')throw Error('download body mismatch');
const del=await fetch(base+'/api/downloads/'+stored.download.id,{method:'DELETE',headers:{Cookie:cookie}});if(del.status!==204)throw Error('delete failed');
ws.send(JSON.stringify({type:'tab.close',id:secondId}));await waitFor(()=>[...messages].reverse().find(m=>m.type==='state'&&m.tabs?.length===1),'tab close');ws.close();
console.log(JSON.stringify({ok:true,screencast:true,multiTab:true,tabActivation:true,downloadCapture:true,localFallback:true,downloadApi:true,delete:true}));
