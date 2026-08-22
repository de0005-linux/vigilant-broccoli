import http from 'node:http';
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {chromium} from 'playwright-core';
import WebSocket,{WebSocketServer} from 'ws';

const PORT=Number(process.env.PORT||3000);
const ACCESS_TOKEN=String(process.env.ACCESS_TOKEN||'');
const PROFILE_DIR=String(process.env.PROFILE_DIR||'/data/chromium-profile');
const DATA_DIR=String(process.env.DATA_DIR||'/data');
const HOME_URL=String(process.env.HOME_URL||'https://example.com');
const SCREEN_QUALITY=Math.max(30,Math.min(90,Number(process.env.SCREEN_QUALITY||72)));
const BROWSER_LOCALE=String(process.env.BROWSER_LOCALE||'fa-IR');
const BROWSER_TIMEZONE=String(process.env.BROWSER_TIMEZONE||'Asia/Tehran');
const AUTH_COOKIE='__Host-railway_browser';
const SECURE_COOKIE=String(process.env.SECURE_COOKIE??'true').toLowerCase()!=='false';
const ALLOW_PRIVATE_TEST=String(process.env.ALLOW_PRIVATE_TEST||'').toLowerCase()==='true';
const INDEX_PATH=fileURLToPath(new URL('./public/index.html',import.meta.url));
const DOWNLOAD_INDEX=DATA_DIR+'/download-index.json';
const DOWNLOAD_DIR=DATA_DIR+'/downloads';

const json=(res,status,value,headers={})=>{const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':Buffer.byteLength(body),...headers});res.end(body)};
const readBody=async(req,limit=1024*1024)=>{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>limit)throw Error('Request is too large');chunks.push(c)}return Buffer.concat(chunks)};
const parseCookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim().split(/=(.*)/s)).filter(v=>v[0]).map(([k,v=''])=>[k,decodeURIComponent(v)]));
const sessionValue=()=>createHmac('sha256',ACCESS_TOKEN).update('railway-browser:v2').digest('base64url');
const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
const authenticated=req=>Boolean(ACCESS_TOKEN&&safeEqual(parseCookies(req)[AUTH_COOKIE]||'',sessionValue()));
const cookie=(value,maxAge)=>AUTH_COOKIE+'='+encodeURIComponent(value)+'; Path=/; HttpOnly; '+(SECURE_COOKIE?'Secure; ':'')+'SameSite=Strict; Max-Age='+maxAge;
const requestBase=req=>'http:'+'//'+(req.headers.host||'localhost');
const publicHeaders={'cache-control':'no-store','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY'};

function safeName(name){return String(name||'download').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/^\.+/,'').slice(0,180)||'download'}
function contentType(name){const ext=name.toLowerCase().split('.').pop();return({pdf:'application/pdf',zip:'application/zip',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',mp3:'audio/mpeg',txt:'text/plain; charset=utf-8',json:'application/json',csv:'text/csv; charset=utf-8',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})[ext]||'application/octet-stream'}

class DownloadStore{
  constructor(onChange){this.onChange=onChange;this.records=[];this.client=null;this.s3=null;this.signer=null;this.configured=false;this.prefix=String(process.env.S3_PREFIX||'browser-downloads/').replace(/^\/+|\/+$/g,'');if(this.prefix)this.prefix+='/' }
  async init(){await mkdir(DOWNLOAD_DIR,{recursive:true});try{const saved=JSON.parse(await readFile(DOWNLOAD_INDEX,'utf8'));if(Array.isArray(saved))this.records=saved.slice(0,500)}catch{}
    const required=['S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'];this.configured=required.every(k=>String(process.env[k]||''));if(!this.configured)return;
    const mod=await import('@aws-sdk/client-s3'),presigner=await import('@aws-sdk/s3-request-presigner');this.s3=mod;this.signer=presigner.getSignedUrl;
    const cfg={region:String(process.env.S3_REGION||'auto'),credentials:{accessKeyId:String(process.env.S3_ACCESS_KEY_ID),secretAccessKey:String(process.env.S3_SECRET_ACCESS_KEY)},forcePathStyle:String(process.env.S3_FORCE_PATH_STYLE??'true').toLowerCase()!=='false',requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'};if(process.env.S3_ENDPOINT)cfg.endpoint=String(process.env.S3_ENDPOINT);this.client=new mod.S3Client(cfg);
  }
  summary(){let endpoint='AWS S3';try{if(process.env.S3_ENDPOINT)endpoint=new URL(process.env.S3_ENDPOINT).host}catch{}return{configured:this.configured,bucket:this.configured?String(process.env.S3_BUCKET):null,endpoint:this.configured?endpoint:null,mode:this.configured?'s3':'local'}}
  publicRecord(r){return{id:r.id,name:r.name,size:r.size||0,status:r.status,location:r.location||null,key:r.key||null,createdAt:r.createdAt,updatedAt:r.updatedAt,sourceUrl:r.sourceUrl||'',tabTitle:r.tabTitle||'',error:r.error||null}}
  list(){return this.records.map(r=>this.publicRecord(r))}
  async persist(){await mkdir(DATA_DIR,{recursive:true});const tmp=DOWNLOAD_INDEX+'.tmp';await writeFile(tmp,JSON.stringify(this.records));await rename(tmp,DOWNLOAD_INDEX)}
  notify(record){this.onChange?.({type:'download:update',download:this.publicRecord(record),storage:this.summary()})}
  async capture(download,source={}){const id=randomUUID(),name=safeName(download.suggestedFilename()),now=new Date().toISOString(),record={id,name,size:0,status:'downloading',createdAt:now,updatedAt:now,sourceUrl:source.url||'',tabTitle:source.title||'',location:null,key:null,localPath:null,error:null};this.records.unshift(record);this.records=this.records.slice(0,500);await this.persist();this.notify(record);
    const localPath=DOWNLOAD_DIR+'/'+id+'-'+name;
    try{await download.saveAs(localPath);const failure=await download.failure();if(failure)throw Error(failure);const info=await stat(localPath);record.size=info.size;
      if(this.configured){const day=new Date().toISOString().slice(0,10).replaceAll('-','/'),key=this.prefix+day+'/'+id+'-'+name;await this.client.send(new this.s3.PutObjectCommand({Bucket:String(process.env.S3_BUCKET),Key:key,Body:createReadStream(localPath),ContentLength:info.size,ContentType:contentType(name),ContentDisposition:"attachment; filename*=UTF-8''"+encodeURIComponent(name),Metadata:{'source-url':String(source.url||'').slice(0,1800)}}));await unlink(localPath).catch(()=>{});record.location='s3';record.key=key}else{record.location='local';record.localPath=localPath}
      record.status='stored';record.updatedAt=new Date().toISOString();
    }catch(e){record.status='failed';record.error=e.message;record.updatedAt=new Date().toISOString();await unlink(localPath).catch(()=>{})}
    await this.persist();this.notify(record);
  }
  find(id){return this.records.find(r=>r.id===id)}
  async accessUrl(id){const r=this.find(id);if(!r||r.status!=='stored')throw Error('Download not found');if(r.location==='local')return{url:'/api/downloads/'+encodeURIComponent(id)+'/file',expiresIn:null};const ttl=Math.max(60,Math.min(86400,Number(process.env.S3_SIGNED_URL_TTL||900)));const command=new this.s3.GetObjectCommand({Bucket:String(process.env.S3_BUCKET),Key:r.key,ResponseContentDisposition:"attachment; filename*=UTF-8''"+encodeURIComponent(r.name)});return{url:await this.signer(this.client,command,{expiresIn:ttl}),expiresIn:ttl}}
  async remove(id){const i=this.records.findIndex(r=>r.id===id);if(i<0)throw Error('Download not found');const r=this.records[i];if(r.location==='s3'&&r.key){if(!this.configured)throw Error('S3 storage is not configured');await this.client.send(new this.s3.DeleteObjectCommand({Bucket:String(process.env.S3_BUCKET),Key:r.key}))};if(r.localPath)await unlink(r.localPath).catch(()=>{});this.records.splice(i,1);await this.persist();this.onChange?.({type:'download:removed',id,storage:this.summary()})}
}

function blockedHost(host){if(ALLOW_PRIVATE_TEST)return false;host=String(host||'').toLowerCase().replace(/^\[|\]$/g,'');if(['localhost','metadata.google.internal','instance-data.ec2.internal'].includes(host)||host.endsWith('.local')||host.endsWith('.internal'))return true;const type=net.isIP(host);if(type===6)return host==='::1'||host==='::'||host.startsWith('fc')||host.startsWith('fd')||/^fe[89ab]/.test(host);if(type===4){const p=host.split('.').map(Number),[a,b]=p;return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||a>=224}return false}
function normalizeUrl(value){let v=String(value||'').trim();if(!v)return HOME_URL;if(!/^[a-z][a-z\d+.-]*:/i.test(v))v='https:'+'//'+v;const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||blockedHost(u.hostname))throw Error('این آدرس مجاز نیست');return u.href}

class BrowserHub{
  constructor(downloads){this.downloads=downloads;this.context=null;this.records=new Map();this.pageIds=new WeakMap();this.activeId=null;this.clients=new Set();this.ready=false;this.captureToken=0}
  broadcast(value){const data=JSON.stringify(value);for(const ws of this.clients)if(ws.readyState===WebSocket.OPEN)ws.send(data)}
  state(){return{type:'state',ready:this.ready,activeId:this.activeId,tabs:[...this.records.values()].map(r=>({id:r.id,title:r.title||'تب جدید',url:r.url||'about:blank',active:r.id===this.activeId})),homeUrl:HOME_URL,storage:this.downloads.summary()}}
  broadcastState(){this.broadcast(this.state())}
  addClient(ws){this.clients.add(ws);ws.send(JSON.stringify(this.state()));ws.send(JSON.stringify({type:'downloads',items:this.downloads.list(),storage:this.downloads.summary()}));const r=this.active();if(r&&!r.page.isClosed())r.page.screenshot({type:'jpeg',quality:SCREEN_QUALITY}).then(buf=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'frame',tabId:r.id,data:buf.toString('base64'),metadata:{initial:true}}))}).catch(()=>{});ws.on('close',()=>this.clients.delete(ws))}
  async start(){await mkdir(PROFILE_DIR,{recursive:true});const launch={headless:true,viewport:{width:1440,height:900},locale:BROWSER_LOCALE,timezoneId:BROWSER_TIMEZONE,acceptDownloads:true,args:['--disable-dev-shm-usage','--no-sandbox','--disable-setuid-sandbox','--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP metadata.google.internal ~NOTFOUND, MAP instance-data.ec2.internal ~NOTFOUND']};if(process.env.CHROMIUM_PATH)launch.executablePath=String(process.env.CHROMIUM_PATH);this.context=await chromium.launchPersistentContext(PROFILE_DIR,launch);this.context.setDefaultTimeout(30000);
    await this.context.route('**/*',async route=>{try{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&blockedHost(u.hostname))return route.abort('blockedbyclient')}catch{}return route.continue()});
    this.context.on('page',p=>this.ensure(p,true).catch(()=>{}));for(const p of this.context.pages())await this.ensure(p,false);if(!this.records.size)await this.newTab(HOME_URL);else{const first=[...this.records.values()].find(r=>r.url!=='about:blank')||[...this.records.values()][0];if(first.url==='about:blank'){await first.page.goto(normalizeUrl(HOME_URL),{waitUntil:'domcontentloaded'}).catch(()=>{});await this.update(first,false)}await this.activate(first.id)}this.ready=true;this.broadcastState()}
  async ensure(page,activate=false){if(this.pageIds.has(page)){const id=this.pageIds.get(page);if(activate)await this.activate(id);return id}const id=randomUUID(),r={id,page,title:'تب جدید',url:page.url()||'about:blank',session:null};this.pageIds.set(page,id);this.records.set(id,r);const update=()=>this.update(r).catch(()=>{});page.on('framenavigated',f=>{if(f===page.mainFrame())update()});page.on('load',update);page.on('domcontentloaded',update);page.on('download',d=>this.downloads.capture(d,{url:page.url(),title:r.title}).catch(()=>{}));page.on('close',()=>this.closed(id));await this.update(r,false);if(activate)await this.activate(id);else this.broadcastState();return id}
  async update(r,broadcast=true){if(r.page.isClosed())return;r.url=r.page.url()||'about:blank';r.title=(await r.page.title().catch(()=>''))||new URL(r.url==='about:blank'?'https://new-tab.invalid':r.url).hostname.replace('new-tab.invalid','تب جدید');if(broadcast)this.broadcastState()}
  async closed(id){const wasActive=this.activeId===id;this.records.delete(id);if(!wasActive)return this.broadcastState();this.activeId=null;const next=[...this.records.values()][0];if(next)await this.activate(next.id);else if(this.context)await this.newTab(HOME_URL)}
  async stopCapture(r){if(!r?.session)return;try{await r.session.send('Page.stopScreencast')}catch{}try{await r.session.detach()}catch{}r.session=null}
  async startCapture(r){const token=++this.captureToken;await this.stopCapture(r);const session=await this.context.newCDPSession(r.page);r.session=session;session.on('Page.screencastFrame',async event=>{try{await session.send('Page.screencastFrameAck',{sessionId:event.sessionId})}catch{}if(token!==this.captureToken||this.activeId!==r.id)return;this.broadcast({type:'frame',tabId:r.id,data:event.data,metadata:event.metadata})});await session.send('Page.startScreencast',{format:'jpeg',quality:SCREEN_QUALITY,maxWidth:1440,maxHeight:900,everyNthFrame:1});try{const shot=await session.send('Page.captureScreenshot',{format:'jpeg',quality:SCREEN_QUALITY,fromSurface:true});if(token===this.captureToken&&this.activeId===r.id)this.broadcast({type:'frame',tabId:r.id,data:shot.data,metadata:{initial:true}})}catch{}}
  async activate(id){const r=this.records.get(id);if(!r||r.page.isClosed())return;const old=this.records.get(this.activeId);if(old&&old!==r)await this.stopCapture(old);this.activeId=id;await r.page.bringToFront().catch(()=>{});await this.startCapture(r);await this.update(r,false);this.broadcastState()}
  active(){return this.records.get(this.activeId)}
  async newTab(url=HOME_URL){const page=await this.context.newPage(),id=await this.ensure(page,false);await this.activate(id);await page.goto(normalizeUrl(url),{waitUntil:'domcontentloaded'}).catch(()=>{});await this.update(this.records.get(id));return id}
  async closeTab(id){const r=this.records.get(id);if(!r)return;if(this.records.size===1)return this.newTab(HOME_URL).then(()=>r.page.close());await r.page.close()}
  async message(raw){const m=typeof raw==='string'?JSON.parse(raw):raw;if(m.type==='tab.new')return this.newTab(m.url||HOME_URL);if(m.type==='tab.activate')return this.activate(m.id);if(m.type==='tab.close')return this.closeTab(m.id);const r=this.active();if(!r)return;
    if(m.type==='navigate'){await r.page.goto(normalizeUrl(m.url),{waitUntil:'domcontentloaded'}).catch(()=>{});return this.update(r)}
    if(m.type==='back'){await r.page.goBack({waitUntil:'domcontentloaded'}).catch(()=>{});return this.update(r)}
    if(m.type==='forward'){await r.page.goForward({waitUntil:'domcontentloaded'}).catch(()=>{});return this.update(r)}
    if(m.type==='reload'){await r.page.reload({waitUntil:'domcontentloaded'}).catch(()=>{});return this.update(r)}
    if(m.type==='home'){await r.page.goto(HOME_URL,{waitUntil:'domcontentloaded'}).catch(()=>{});return this.update(r)}
    if(m.type==='mouse'){if(m.action==='move')return r.page.mouse.move(Number(m.x),Number(m.y));if(m.action==='click')return r.page.mouse.click(Number(m.x),Number(m.y),{button:m.button||'left',clickCount:Number(m.clickCount||1)});if(m.action==='wheel')return r.page.mouse.wheel(Number(m.dx||0),Number(m.dy||0))}
    if(m.type==='text')return r.page.keyboard.insertText(String(m.text||''));if(m.type==='key'){const key=String(m.key||'');if(!key)return;if(m.action==='up')return r.page.keyboard.up(key).catch(()=>{});return r.page.keyboard.down(key).catch(()=>{})}
  }
  async close(){this.captureToken++;for(const r of this.records.values())await this.stopCapture(r);await this.context?.close()}
}

let hub;const downloads=new DownloadStore(event=>hub?.broadcast(event));hub=new BrowserHub(downloads);await downloads.init();

const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,requestBase(req));
  if(u.pathname==='/healthz')return json(res,hub.ready?200:503,{ok:hub.ready,browserReady:hub.ready,storageConfigured:downloads.configured});
  if(u.pathname==='/api/status')return json(res,200,{configured:Boolean(ACCESS_TOKEN),authenticated:authenticated(req),browserReady:hub.ready,storage:authenticated(req)?downloads.summary():undefined});
  if(u.pathname==='/api/login'&&req.method==='POST'){if(!ACCESS_TOKEN)return json(res,503,{error:'ACCESS_TOKEN تنظیم نشده است'});const b=JSON.parse((await readBody(req,16384)).toString()||'{}');if(!safeEqual(b.token||'',ACCESS_TOKEN))return json(res,401,{error:'توکن نادرست ��ست'});return json(res,200,{ok:true},{'set-cookie':cookie(sessionValue(),43200)})}
  if(u.pathname==='/api/logout'&&req.method==='POST')return json(res,200,{ok:true},{'set-cookie':cookie('',0)});
  if(u.pathname==='/api/exit-ip'){if(!authenticated(req))return json(res,401,{error:'Unauthorized'});try{const r=await fetch('https:'+'//api.ipify.org?format=json',{signal:AbortSignal.timeout(10000)});return json(res,200,{ok:true,...await r.json()})}catch(e){return json(res,502,{error:e.message})}}
  if(u.pathname==='/api/downloads'&&req.method==='GET'){if(!authenticated(req))return json(res,401,{error:'Unauthorized'});return json(res,200,{items:downloads.list(),storage:downloads.summary()})}
  const urlMatch=u.pathname.match(/^\/api\/downloads\/([^/]+)\/url$/);if(urlMatch&&req.method==='POST'){if(!authenticated(req))return json(res,401,{error:'Unauthorized'});return json(res,200,await downloads.accessUrl(decodeURIComponent(urlMatch[1])))}
  const fileMatch=u.pathname.match(/^\/api\/downloads\/([^/]+)\/file$/);if(fileMatch&&req.method==='GET'){if(!authenticated(req))return json(res,401,{error:'Unauthorized'});const r=downloads.find(decodeURIComponent(fileMatch[1]));if(!r||r.location!=='local'||!r.localPath)return json(res,404,{error:'Not found'});const s=await stat(r.localPath);res.writeHead(200,{'content-type':contentType(r.name),'content-length':s.size,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(r.name),'cache-control':'private, no-store'});return createReadStream(r.localPath).pipe(res)}
  const delMatch=u.pathname.match(/^\/api\/downloads\/([^/]+)$/);if(delMatch&&req.method==='DELETE'){if(!authenticated(req))return json(res,401,{error:'Unauthorized'});await downloads.remove(decodeURIComponent(delMatch[1]));res.writeHead(204);return res.end()}
  if((u.pathname==='/'||u.pathname==='/app')&&req.method==='GET'){const body=await readFile(INDEX_PATH);res.writeHead(200,{...publicHeaders,'content-type':'text/html; charset=utf-8','content-length':body.length});return res.end(body)}
  res.writeHead(404,publicHeaders);res.end('Not found');
}catch(e){json(res,500,{error:e.message})}});

const wss=new WebSocketServer({noServer:true,maxPayload:1024*1024});
server.on('upgrade',(req,socket,head)=>{
  try{
    const u=new URL(req.url,requestBase(req));
    if(u.pathname!=='/ws'||!authenticated(req))throw Error('Unauthorized');
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  }catch{
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }
});
wss.on('connection',ws=>{
  hub.addClient(ws);
  ws.on('message',data=>{
    hub.message(data.toString()).catch(e=>{
      if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'error',message:e.message}));
    });
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log('Railway browser listening on '+PORT));hub.start().catch(e=>{console.error(e);setTimeout(()=>process.exit(1),1000).unref()});
for(const sig of['SIGTERM','SIGINT'])process.on(sig,async()=>{await hub.close().catch(()=>{});server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref()});
