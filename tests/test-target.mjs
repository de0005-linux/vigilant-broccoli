import http from 'node:http';
const file=Buffer.from('railway-browser-download-ok\n');
const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<!doctype html><title>Test Home</title><h1>Test Home</h1><a href="/page2" target="_blank">Open tab</a><a href="/download">Download</a>')}
  if(req.url==='/page2'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<!doctype html><title>Page Two</title><h1>Second tab</h1>')}
  if(req.url==='/download'){res.writeHead(200,{'content-type':'text/plain','content-length':file.length,'content-disposition':'attachment; filename="test-download.txt"'});return res.end(file)}
  res.writeHead(404);res.end('not found');
});
server.listen(3344,'127.0.0.1',()=>console.log('browser target ready'));
