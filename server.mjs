import http from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {lookup} from 'node:dns/promises';
import WebSocket,{WebSocketServer} from 'ws';

const PORT=Number(process.env.PORT||3000);
const TOKEN=String(process.env.ACCESS_TOKEN||'');
const DATA_DIR=String(process.env.DATA_DIR||'/data');
const COOKIE_FILE=DATA_DIR+'/proxy-cookie-jar.json';
const INDEX=fileURLToPath(new URL('./public/index.html',import.meta.url));
const AUTH_COOKIE='__Host-railway_web_proxy';
const ALLOW_PRIVATE_TEST=String(process.env.ALLOW_PRIVATE_TEST||'').toLowerCase()==='true';
const MAX_BODY=25*1024*1024;
const DROP_REQUEST=new Set(['host','cookie','authorization','proxy-authorization','connection','content-length','accept-encoding','cf-connecting-ip','x-forwarded-for','x-forwarded-host','x-forwarded-proto','true-client-ip']);
const DROP_RESPONSE=new Set(['set-cookie','content-length','content-encoding','transfer-encoding','connection','content-security-policy','content-security-policy-report-only','x-frame-options','cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy','permissions-policy','strict-transport-security']);

const authHash=()=>createHmac('sha256',TOKEN).update('railway-web-proxy:v1').digest('base64url');
const safeEqual=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&timingSafeEqual(a,b)};
const parseCookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x[0]).map(([k,v=''])=>[k,decodeURIComponent(v)]));
const authed=req=>Boolean(TOKEN&&safeEqual(parseCookies(req)[AUTH_COOKIE]||'',authHash()));
const base=req=>'http:'+'//'+(req.headers.host||'localhost');
const json=(res,status,payload,headers={})=>{const b=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':Buffer.byteLength(b),...headers});res.end(b)};
const securityHeaders={'cache-control':'no-store','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self' ws: wss:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY'};

async function readBody(req,limit=MAX_BODY){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>limit)throw Error('Request body too large');chunks.push(c)}return Buffer.concat(chunks)}
function splitSetCookie(value=''){return value.split(/,(?=\s*[^;,\s]+=)/g).map(x=>x.trim()).filter(Boolean)}
function defaultPath(pathname){if(!pathname||!pathname.startsWith('/')||pathname==='/')return'/';return pathname.slice(0,pathname.lastIndexOf('/')+1)||'/'}
function domainMatch(host,domain,hostOnly){host=host.toLowerCase();domain=domain.toLowerCase();return hostOnly?host===domain:host===domain||host.endsWith('.'+domain)}
function pathMatch(pathname,cookiePath){return pathname===cookiePath||pathname.startsWith(cookiePath.endsWith('/')?cookiePath:cookiePath+'/')}

class CookieJar{
  map=new Map();saveTimer=null;
  async load(){await mkdir(DATA_DIR,{recursive:true});try{const data=JSON.parse(await readFile(COOKIE_FILE,'utf8'));for(const c of data)if(c&&c.name)this.map.set(this.key(c),c)}catch{}}
  key(c){return c.domain+'|'+c.path+'|'+c.name}
  set(header,target,fromDocument=false){
    const parts=String(header||'').split(';').map(x=>x.trim()).filter(Boolean);if(!parts.length)return;
    const first=parts.shift(),eq=first.indexOf('=');if(eq<=0)return;
    const now=Date.now(),c={name:first.slice(0,eq).trim(),value:first.slice(eq+1),domain:target.hostname.toLowerCase(),path:defaultPath(target.pathname),hostOnly:true,secure:false,httpOnly:false,sameSite:'',expires:null,created:now};
    for(const p of parts){const [raw,...rest]=p.split('=');const k=raw.toLowerCase(),v=rest.join('=');if(k==='domain'){const d=v.replace(/^\./,'').toLowerCase();if(!domainMatch(target.hostname,d,false))return;c.domain=d;c.hostOnly=false}else if(k==='path'&&v.startsWith('/'))c.path=v;else if(k==='secure')c.secure=true;else if(k==='httponly'&&!fromDocument)c.httpOnly=true;else if(k==='samesite')c.sameSite=v;else if(k==='expires'){const t=Date.parse(v);if(Number.isFinite(t))c.expires=t}else if(k==='max-age'){const n=Number(v);if(Number.isFinite(n))c.expires=now+n*1000}}
    const key=this.key(c);if(c.expires!==null&&c.expires<=now)this.map.delete(key);else this.map.set(key,c);if(this.map.size>1500){const oldest=[...this.map.entries()].sort((a,b)=>a[1].created-b[1].created).slice(0,200);for(const [k]of oldest)this.map.delete(k)}this.schedule();
  }
  ingest(headers,target){const list=typeof headers.getSetCookie==='function'?headers.getSetCookie():splitSetCookie(headers.get('set-cookie')||'');for(const h of list)this.set(h,target,false)}
  valid(target,includeHttpOnly=true){const now=Date.now(),out=[];for(const [k,c]of this.map){if(c.expires!==null&&c.expires<=now){this.map.delete(k);continue}if(c.secure&&target.protocol!=='https:')continue;if(!domainMatch(target.hostname,c.domain,c.hostOnly)||!pathMatch(target.pathname,c.path))continue;if(!includeHttpOnly&&c.httpOnly)continue;out.push(c)}return out.sort((a,b)=>b.path.length-a.path.length)}
  header(target){return this.valid(target,true).map(c=>c.name+'='+c.value).join('; ')}
  document(target){return this.valid(target,false).map(c=>c.name+'='+c.value).join('; ')}
  schedule(){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.save().catch(()=>{}),250);this.saveTimer.unref?.()}
  async save(){await mkdir(DATA_DIR,{recursive:true});const tmp=COOKIE_FILE+'.tmp';await writeFile(tmp,JSON.stringify([...this.map.values()]));await rename(tmp,COOKIE_FILE)}
}
const jar=new CookieJar();await jar.load();

function privateIp(host){
  host=host.toLowerCase().replace(/^\[|\]$/g,'');
  if(host.includes(':'))return host==='::'||host==='::1'||host.startsWith('fc')||host.startsWith('fd')||/^fe[89ab]/.test(host)||host.startsWith('::ffff:127.')||host.startsWith('::ffff:10.')||host.startsWith('::ffff:192.168.');
  if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(host))return false;const p=host.split('.').map(Number);if(p.some(x=>x>255))return true;const[a,b,c]=p;return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0&&[0,2].includes(c))||(a===198&&[18,19].includes(b))||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113)||a>=224;
}
async function assertTarget(target,requestHost=''){
  if(!['http:','https:','ws:','wss:'].includes(target.protocol))throw Error('Only HTTP, HTTPS, WS and WSS are supported');
  if(target.username||target.password)throw Error('Credentials in target URL are not allowed');
  const h=target.hostname.toLowerCase();if(h===requestHost||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||privateIp(h)){if(!ALLOW_PRIVATE_TEST)throw Error('Private and local destinations are blocked')}
  if(!ALLOW_PRIVATE_TEST&&!privateIp(h)){const records=await lookup(h,{all:true,verbatim:true});if(!records.length||records.some(r=>privateIp(r.address)))throw Error('Destination resolved to a private address')}
}
function proxyPath(value){const u=value instanceof URL?value:new URL(value);return'/p/'+u.protocol.slice(0,-1)+'/'+encodeURIComponent(u.host)+(u.pathname||'/')+u.search+u.hash}
function parseProxyPath(reqUrl){const parts=reqUrl.pathname.split('/');if(parts[1]!=='p'||!parts[2]||!parts[3])throw Error('Invalid proxy URL');const scheme=parts[2],host=decodeURIComponent(parts[3]),pathname='/'+parts.slice(4).join('/');return new URL(scheme+':'+'//'+host+(pathname||'/')+reqUrl.search)}
function rewriteUrl(raw,target){if(!raw)return raw;const v=String(raw).trim();if(/^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(v))return raw;try{const u=new URL(v,target);return['http:','https:'].includes(u.protocol)?proxyPath(u):raw}catch{return raw}}
function rewriteCss(css,target){return String(css).replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi,(m,q,v)=>'url('+q+rewriteUrl(v,target)+q+')').replace(/@import\s+(["'])(.*?)\1/gi,(m,q,v)=>'@import '+q+rewriteUrl(v,target)+q)}
function escapeAttr(s){return String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}
function bridgeScript(target,documentCookies){
  const T=JSON.stringify(target.href).replaceAll('<','\\u003c'),C=JSON.stringify(documentCookies).replaceAll('<','\\u003c');
  return`(()=>{const T=${T},P=location.origin,C=${C};const px=v=>{try{const u=new URL(String(v),T);if(!/^https?:$/.test(u.protocol))return v;if(u.origin===location.origin&&u.pathname.startsWith('/p/'))return v;return P+'/p/'+u.protocol.slice(0,-1)+'/'+encodeURIComponent(u.host)+u.pathname+u.search+u.hash}catch{return v}};const F=window.fetch.bind(window);window.fetch=(i,n)=>i instanceof Request?F(new Request(px(i.url),i),n):F(px(i),n);const O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){return O.call(this,m,px(u),...r)};const B=navigator.sendBeacon?.bind(navigator);if(B)navigator.sendBeacon=(u,d)=>B(px(u),d);const E=window.EventSource;if(E)window.EventSource=function(u,c){return new E(px(u),c)};const W=window.WebSocket;if(W)window.WebSocket=function(u,p){const x=new URL(String(u),T),q=(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws?url='+encodeURIComponent(x.href);return new W(q,p)};window.WebSocket.prototype=W?.prototype;const N=window.open;window.open=(u,...r)=>N.call(window,px(u),...r);for(const k of['pushState','replaceState']){const n=history[k].bind(history);history[k]=(s,t,u)=>n(s,t,u==null?u:px(u))}const attrs=['href','src','action','poster','data','srcset'];const fix=e=>{if(!e?.getAttribute)return;for(const a of attrs){const v=e.getAttribute(a);if(v&&!v.startsWith('data:'))e.setAttribute(a,a==='srcset'?v.split(',').map(x=>{const z=x.trim().split(/\\s+/);z[0]=px(z[0]);return z.join(' ')}).join(', '):px(v))}};new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{fix(n);n.querySelectorAll?.('[href],[src],[action],[poster],[data],[srcset]').forEach(fix)}))).observe(document,{subtree:true,childList:true});addEventListener('submit',e=>{if(e.target?.action)e.target.action=px(e.target.action)},true);try{const m=new Map(C.split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x[0]));Object.defineProperty(document,'cookie',{configurable:true,get(){return[...m].map(x=>x[0]+'='+x[1]).join('; ')},set(v){const a=String(v).split(';'),[k,...r]=a[0].split('=');if(k)m.set(k.trim(),r.join('='));navigator.sendBeacon('/api/cookie',new Blob([JSON.stringify({url:T,cookie:String(v)})],{type:'application/json'}))}})}catch{}try{parent.postMessage({type:'railway-proxy:navigation',url:T},location.origin)}catch{}})();`;
}
function rewriteHtml(html,target){
  let out=String(html).replace(/<base\b[^>]*>/gi,'');
  out=out.replace(/(\s(?:href|src|action|poster|data|cite|background)\s*=\s*)(["'])(.*?)\2/gi,(m,p,q,v)=>p+q+escapeAttr(rewriteUrl(v,target))+q);
  out=out.replace(/(\s(?:href|src|action|poster|data|cite|background)\s*=\s*)([^\s"'=<>`]+)/gi,(m,p,v)=>p+escapeAttr(rewriteUrl(v,target)));
  out=out.replace(/(\ssrcset\s*=\s*)(["'])(.*?)\2/gi,(m,p,q,v)=>p+q+v.split(',').map(x=>{const z=x.trim().split(/\s+/);z[0]=rewriteUrl(z[0],target);return z.join(' ')}).join(', ')+q);
  out=out.replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gi,(m,p,q,v)=>p+q+escapeAttr(rewriteCss(v,target))+q);
  out=out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,(m,a,c,z)=>a+rewriteCss(c,target)+z);
  out=out.replace(/(<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*content=["'])([^"']*)(["'][^>]*>)/gi,(m,a,c,z)=>a+c.replace(/url\s*=\s*(.+)$/i,(x,v)=>'url='+rewriteUrl(v.trim(),target))+z);
  const dir=new URL('.',target),inject='<base href="'+escapeAttr(proxyPath(dir))+'"><script>'+bridgeScript(target,jar.document(target))+'<\/script>';
  return/<head\b[^>]*>/i.test(out)?out.replace(/<head\b[^>]*>/i,m=>m+inject):inject+out;
}
function responseHeaders(upstream,target,reqUrl){const h={};for(const[k,v]of upstream.headers){const n=k.toLowerCase();if(DROP_RESPONSE.has(n)||n.startsWith('access-control-'))continue;h[k]=v}h['cache-control']='no-store';h['referrer-policy']='no-referrer';const loc=upstream.headers.get('location');if(loc)h.location=rewriteUrl(loc,target);return h}
async function proxyRequest(req,res,reqUrl){
  if(!authed(req))return json(res,401,{error:'Unauthorized'});
  const target=parseProxyPath(reqUrl);await assertTarget(target,(req.headers.host||'').split(':')[0]);
  const headers=new Headers();for(const[k,v]of Object.entries(req.headers)){if(v==null||DROP_REQUEST.has(k)||k.startsWith('sec-fetch-'))continue;headers.set(k,Array.isArray(v)?v.join(', '):v)}
  const c=jar.header(target);if(c)headers.set('cookie',c);if(req.headers.origin)headers.set('origin',target.origin);const referer=req.headers.referer;headers.set('referer',referer?.includes('/p/')?target.href:target.origin+'/');
  const method=req.method||'GET',payload=['GET','HEAD'].includes(method)?undefined:await readBody(req);const upstream=await fetch(target,{method,headers,body:payload,redirect:'manual'});jar.ingest(upstream.headers,target);
  const type=(upstream.headers.get('content-type')||'').toLowerCase(),headersOut=responseHeaders(upstream,target,reqUrl);
  if(method==='HEAD'){res.writeHead(upstream.status,headersOut);return res.end()}
  if(type.includes('text/html')||type.includes('application/xhtml+xml')){const text=rewriteHtml(await upstream.text(),target);headersOut['content-type']='text/html; charset=utf-8';res.writeHead(upstream.status,headersOut);return res.end(text)}
  if(type.includes('text/css')){const text=rewriteCss(await upstream.text(),target);headersOut['content-type']='text/css; charset=utf-8';res.writeHead(upstream.status,headersOut);return res.end(text)}
  if(type.includes('mpegurl')){const text=(await upstream.text()).split(/\r?\n/).map(x=>!x.trim()||x.trim().startsWith('#')?x:rewriteUrl(x.trim(),target)).join('\n');res.writeHead(upstream.status,headersOut);return res.end(text)}
  res.writeHead(upstream.status,headersOut);if(upstream.body)Readable.fromWeb(upstream.body).pipe(res);else res.end();
}

const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,base(req));
  if(u.pathname==='/healthz')return json(res,200,{ok:true,cookies:jar.map.size});
  if(u.pathname==='/api/status')return json(res,200,{configured:Boolean(TOKEN),authenticated:authed(req)});
  if(u.pathname==='/api/login'&&req.method==='POST'){if(!TOKEN)return json(res,503,{error:'ACCESS_TOKEN is not configured'});const b=JSON.parse((await readBody(req,16384)).toString()||'{}');if(!safeEqual(b.token||'',TOKEN))return json(res,401,{error:'Invalid token'});return json(res,200,{ok:true},{'set-cookie':AUTH_COOKIE+'='+encodeURIComponent(authHash())+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200'})}
  if(u.pathname==='/api/logout'&&req.method==='POST')return json(res,200,{ok:true},{'set-cookie':AUTH_COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
  if(u.pathname==='/api/cookie'&&req.method==='POST'){if(!authed(req))return json(res,401,{error:'Unauthorized'});const b=JSON.parse((await readBody(req,16384)).toString()||'{}'),t=new URL(b.url);await assertTarget(t);jar.set(b.cookie,t,true);res.writeHead(204);return res.end()}
  if(u.pathname==='/api/exit-ip'){if(!authed(req))return json(res,401,{error:'Unauthorized'});try{const r=await fetch('https:'+'//api.ipify.org?format=json',{signal:AbortSignal.timeout(10000)});return json(res,200,{ok:true,...await r.json(),source:'Railway outbound'})}catch(e){return json(res,502,{error:e.message})}}
  if(u.pathname.startsWith('/p/'))return await proxyRequest(req,res,u);
  if((u.pathname==='/'||u.pathname==='/app')&&req.method==='GET'){const html=await readFile(INDEX);res.writeHead(200,{...securityHeaders,'content-type':'text/html; charset=utf-8','content-length':html.length});return res.end(html)}
  res.writeHead(404,securityHeaders);res.end('Not found');
}catch(e){json(res,500,{error:e.message})}});

const wss=new WebSocketServer({noServer:true,maxPayload:16*1024*1024});
server.on('upgrade',async(req,socket,head)=>{try{const u=new URL(req.url,base(req));if(u.pathname!=='/ws'||!authed(req))throw Error('Unauthorized');const target=new URL(u.searchParams.get('url')||'');if(!['ws:','wss:'].includes(target.protocol))throw Error('Invalid WebSocket target');await assertTarget(target,(req.headers.host||'').split(':')[0]);wss.handleUpgrade(req,socket,head,client=>wss.emit('connection',client,req,target))}catch(e){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy()}});
wss.on('connection',(client,req,target)=>{const httpTarget=new URL(target.href.replace(/^ws/,'http')),cookie=jar.header(httpTarget);const upstream=new WebSocket(target,{headers:{origin:httpTarget.origin,'user-agent':req.headers['user-agent']||'Mozilla/5.0',...(cookie?{cookie}:{})}});const queue=[];client.on('message',(d,b)=>upstream.readyState===WebSocket.OPEN?upstream.send(d,{binary:b}):queue.push([d,b]));upstream.on('open',()=>queue.splice(0).forEach(([d,b])=>upstream.send(d,{binary:b})));upstream.on('message',(d,b)=>client.readyState===WebSocket.OPEN&&client.send(d,{binary:b}));const close=()=>{client.close();upstream.close()};client.on('close',()=>upstream.close());upstream.on('close',()=>client.close());client.on('error',close);upstream.on('error',close)});
server.listen(PORT,'0.0.0.0',()=>console.log('Railway web proxy listening on '+PORT));
for(const sig of['SIGTERM','SIGINT'])process.on(sig,async()=>{await jar.save().catch(()=>{});server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref()});
