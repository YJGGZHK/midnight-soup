import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { parseEnv } from 'node:util';
import { catalogue, puzzles, judge, labels, MODEL } from './game.mjs';

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12000) fail(413, '请求过大。');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, '请求格式有误。');
    return data;
  } catch { fail(400, '请求格式有误。'); }
}
async function readEnv() {
  try { return parseEnv(await readFile(new URL('./.env', import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
const addresses = () => Object.values(networkInterfaces()).flat().filter(item => item.family === 'IPv4').map(item => item.address);
export function createApp({
  getApiKey = async () => (await readEnv()).AI_GATEWAY_API_KEY?.trim() || process.env.AI_GATEWAY_API_KEY || '',
  accessToken = randomUUID(),
  runJudge = judge,
} = {}) {
  const allowedHosts = new Set(['localhost', '127.0.0.1', ...addresses()]);
  // ponytail: 本地单人 demo 用内存保存会话，服务重启后重开；多人部署时再加持久化和独立用户认证。
  const sessions = new Map();
  function view(session) {
    const { puzzle, ...safe } = session;
    delete safe.busy;
    return { ...safe, puzzleId: puzzle.id, ...(session.ended ? { truth: puzzle.truth, facts: puzzle.facts, source: puzzle.source, adaptation: puzzle.adaptation } : {}) };
  }
  return createServer(async (req, res) => {
    const host = req.headers.host || '';
    const origin = `http://${host}`;
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (!allowedHosts.has(new URL(origin).hostname)) fail(403, '不允许的访问地址。');
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') fail(403, '不允许跨站请求。');
      const url = new URL(req.url, origin);
      const isLocal = req.socket.remoteAddress === '127.0.0.1';
      if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('access') === accessToken) {
        res.writeHead(303, { Location: '/', 'Set-Cookie': `soup_access=${accessToken}; HttpOnly; SameSite=Strict; Path=/`, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (!isLocal && !(req.headers.cookie || '').split(';').some(value => value.trim() === `soup_access=${accessToken}`)) fail(401, '请使用带访问码的完整链接打开，避免他人消耗你的模型额度。');
      if (req.method === 'GET' && url.pathname === '/api/catalogue') return json({ puzzles: catalogue(), configured: Boolean(await getApiKey()), model: MODEL });
      if (req.method === 'GET' && url.pathname === '/api/session') {
        const session = sessions.get(url.searchParams.get('id'));
        if (!session) fail(404, '这局已失效，请重新开局。');
        return json(view(session));
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (!req.headers['content-type']?.startsWith('application/json')) fail(415, '仅接受 JSON。');
        const body = await readBody(req);
        if (url.pathname === '/api/session') {
          const puzzle = puzzles.find(p => p.id === body.puzzleId);
          if (!puzzle) fail(400, '请选择题目。');
          const id = randomUUID();
          const session = { id, puzzle, messages: [], asked: [], hints: 0, turns: 0, ended: false, solved: false };
          sessions.set(id, session);
          return json(view(session));
        }
        if (url.pathname !== '/api/action') fail(404, '接口不存在。');
        const session = sessions.get(body.id);
        if (!session) fail(404, '这局已失效，请重新开局。');
        if (session.ended) fail(409, '这局已结束，可以换一碗汤。');
        if (session.busy) fail(409, '主持人正在思考，请稍候。');
        const { puzzle } = session;
        if (body.action === 'hint') {
          if (session.hints >= puzzle.hints.length) fail(409, '三个提示已经全部用完。');
          session.messages.push({ role: 'host', kind: 'hint', text: puzzle.hints[session.hints++] });
        } else if (body.action === 'reveal') {
          session.ended = true;
        } else if (body.action === 'ask' || body.action === 'solve') {
          const solving = body.action === 'solve';
          let text = body.text;
          if (typeof text !== 'string' || !text.trim() || text.length > 1200) fail(400, '请输入 1–1200 字的内容。');
          text = text.trim();
          if (session.turns >= 60) fail(409, '本局已达 60 次提问上限，请查看汤底或重新开局。');
          let result;
          session.busy = true;
          try {
            const key = await getApiKey();
            if (!key) fail(409, '未配置 Key，请填写 .env 中的 AI_GATEWAY_API_KEY。');
            result = await runJudge(key, puzzle, text, solving);
          } catch (error) {
            if (error.status) throw error;
            fail(502, 'Jev 暂时未能完成判断。请检查网关额度、权限或网络，再重试。');
          } finally { session.busy = false; }
          session.turns++;
          session.asked.push(text);
          session.messages.push({ role: 'player', text, kind: solving ? 'solve' : 'ask' });
          session.messages.push({ role: 'host', kind: solving ? 'evaluation' : 'answer', ...result,
            text: solving ? `命中 ${result.hits}/${result.total} 个关键事实。${result.solved ? '真相已经浮出水面。' : '还差一点，再把因果关系串起来。'}` : labels[result.verdict],
          });
          if (solving && result.solved) { session.solved = true; session.ended = true; }
        } else fail(400, '未知操作。');
        return json(view(session));
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/catalogue.js': ['catalogue.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method !== 'GET' || !assets[url.pathname]) fail(404, '页面不存在。');
      const [file, type] = assets[url.pathname];
      res.writeHead(200, {
        'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(await readFile(new URL(`./public/${file}`, import.meta.url)));
    } catch (error) { json({ error: error.status ? error.message : '服务器处理失败，请重试。' }, error.status || 500); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = await readEnv();
  const accessToken = env.ACCESS_TOKEN || randomUUID();
  const server = createApp({ accessToken });
  server.listen(Number(process.env.PORT || env.PORT || 8787), process.env.HOST || env.HOST || '0.0.0.0', () => {
    const port = server.address().port;
    console.log(`本机 → http://127.0.0.1:${port}`);
    for (const ip of addresses().filter(ip => ip !== '127.0.0.1')) console.log(`局域网 → http://${ip}:${port}/?access=${accessToken}`);
    console.log('Key 配置：项目 .env 中的 AI_GATEWAY_API_KEY，保存后即时生效。');
  });
}
