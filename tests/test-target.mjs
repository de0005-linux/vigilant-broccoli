import http from 'node:http';
import {WebSocketServer} from 'ws';
const server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','set-cookie':'session=alpha; Path=/; HttpOnly'});return res.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><a href="/next">Next</a><form action="/login" method="post"><input name="u"><button>Login</button></form><script>fetch("/api").catch(()=>{})</script></body></html>')}
  if(req.url==='/style.css'){res.writeHead(200,{'content-type':'text/css'});return res.end('body{background:url("/bg.png")}')}
  if(req.url==='/next'){res.writeHead(200,{'content-type':'text/html'});return res.end('<h1>next</h1><pre>'+String(req.headers.cookie||'')+'</pre>')}
  if(req.url==='/login'&&req.method==='POST'){for await(const _ of req){}res.writeHead(302,{'location':'/account','set-cookie':'auth=ok; Path=/; HttpOnly'});return res.end()}
  if(req.url==='/account'){res.writeHead(200,{'content-type':'text/plain'});return res.end(String(req.headers.cookie||''))}
  if(req.url==='/api'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"ok":true}')}
  res.writeHead(404);res.end('not found');
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws)));
wss.on('connection',ws=>ws.on('message',(d,b)=>ws.send(d,{binary:b})));
server.listen(3333,'127.0.0.1',()=>console.log('target ready'));
