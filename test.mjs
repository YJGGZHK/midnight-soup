import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { networkInterfaces } from 'node:os';
import { filterPuzzles, randomPuzzle } from './public/catalogue.js';
import { createApp } from './server.mjs';
import { catalogue, puzzles, judge, evaluationRequest, MODEL } from './game.mjs';

test('海龟汤：保密、Jev 全流程、结果处理、请求与局域网保护', async t => {
  let key = '', failure = false, calls = 0;
  const app = createApp({ accessToken: 'test-access-token', getApiKey: async () => key,
    runJudge: async (receivedKey, puzzle, text, solving) => {
      calls++; assert.equal(receivedKey, 'test-key');
      if (failure) throw new Error('upstream response with sensitive data');
      return solving ? { hits: 3, total: 3, solved: true, ms: 10 } : { verdict: 'yes', ms: 10 };
    },
  });
  app.listen(0, '0.0.0.0');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const port = app.address().port;
  const base = `http://127.0.0.1:${port}`;
  async function request(path, data, status = 200, headers = {}) {
    const response = await fetch(base + path, data ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) } : { headers });
    assert.equal(response.status, status, `${path}: ${response.status}`);
    return response.json();
  }
  const list = await request('/api/catalogue');
  assert.equal(list.configured, false);
  assert.equal(list.puzzles.length, 35);
  assert.equal(new Set(puzzles.map(p => p.id)).size, puzzles.length);
  assert.equal(puzzles.filter(p => p.id.startsWith('tb-')).length, 32);
  for (const p of catalogue()) {
    assert.equal(p.truth, undefined);
    assert.equal(p.facts, undefined);
    assert.equal(p.hints, undefined);
    assert.equal(p.adaptation, undefined);
    const full = puzzles.find(item => item.id === p.id);
    assert.equal(full.facts.length, 3);
    assert.equal(full.hints.length, 3);
    assert.ok(full.facts.every(Boolean) && full.hints.every(Boolean));
    assert.ok(p.title && p.teaser && p.genre && p.difficulty && p.source);
    assert.ok(Array.isArray(p.warnings));
    assert.ok(!JSON.stringify(p).includes(full.truth));
    assert.equal(typeof p.questions[0], 'string');
  }
  for (const path of ['/.env', '/game.mjs', '/server.mjs', '/node_modules/ai/package.json', '/data/turtlebench.json', '/data/originals.json']) await request(path, null, 404);
  assert.equal((await fetch(base)).status, 200);
  await request('/api/session', { puzzleId: 'wrong' }, 400);
  const unconfigured = await request('/api/session', { puzzleId: 'dinner' });
  await request('/api/action', { id: unconfigured.id, action: 'ask', text: puzzles[0].questions[0] }, 409);
  await request('/api/action', { id: unconfigured.id, action: 'solve', text: '完整推理' }, 409);
  assert.equal((await request(`/api/session?id=${unconfigured.id}`)).messages.length, 0);
  assert.equal(calls, 0);
  key = 'test-key';
  await request('/api/session', { puzzleId: 'dinner' }, 403, { Origin: 'https://evil.invalid' });
  const badHostStatus = await new Promise((resolve, reject) => {
    get(base + '/api/catalogue', { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  const malformed = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  await request('/api/session', { puzzleId: 'x'.repeat(13000) }, 413);
  for (const p of puzzles) {
    let s = await request('/api/session', { puzzleId: p.id });
    const id = s.id;
    assert.equal(s.truth, undefined);
    await request('/api/action', { id, action: 'ask', text: '' }, 400);
    const countBefore = calls;
    await request('/api/action', { id, action: 'ask', text: '自由输入的问题' });
    assert.equal(calls, countBefore + 1);
    for (const text of p.questions) {
      s = await request('/api/action', { id, action: 'ask', text });
      assert.equal(s.messages.at(-1).verdict, 'yes');
      assert.equal(s.truth, undefined);
    }
    assert.equal(s.turns, p.questions.length + 1);
    assert.equal(calls, countBefore + p.questions.length + 1, '推荐问题也必须调用模型');
    const resumed = await request(`/api/session?id=${id}`);
    assert.deepEqual(resumed.messages, s.messages);
    for (let i = 0; i < 3; i++) {
      s = await request('/api/action', { id, action: 'hint' });
      assert.equal(s.hints, i + 1);
      assert.equal(s.messages.at(-1).text, p.hints[i]);
    }
    await request('/api/action', { id, action: 'hint' }, 409);
    s = await request('/api/action', { id, action: 'reveal' });
    assert.equal(s.truth, p.truth);
    assert.equal(s.solved, false);
    assert.equal(s.adaptation, p.adaptation);
    assert.equal(s.source, p.source);
    const guessing = await request('/api/session', { puzzleId: p.id });
    const solvedPuzzle = await request('/api/action', { id: guessing.id, action: 'solve', text: p.truth });
    assert.equal(solvedPuzzle.solved, true);
    assert.equal(solvedPuzzle.truth, p.truth);
    await request('/api/action', { id, action: 'ask', text: p.questions[0] }, 409);
  }
  key = 'test-key';
  assert.equal((await request('/api/catalogue')).configured, true);
  const s = await request('/api/session', { puzzleId: 'dinner' });
  const answer = await request('/api/action', { id: s.id, action: 'ask', text: '她是独居吗？' });
  assert.equal(answer.messages.at(-1).verdict, 'yes');
  assert.equal(answer.truth, undefined);
  failure = true;
  const error = await request('/api/action', { id: s.id, action: 'ask', text: '再问一个问题' }, 502);
  assert.ok(!error.error.includes('sensitive'));
  assert.equal((await request(`/api/session?id=${s.id}`)).turns, 1, '失败不写入历史');
  failure = false;
  key = '';
  await request('/api/action', { id: s.id, action: 'ask', text: 'Key 被移除' }, 409);
  key = 'test-key';
  const solved = await request('/api/action', { id: s.id, action: 'solve', text: '完整真相' });
  assert.equal(solved.solved, true); assert.equal(solved.ended, true); assert.equal(solved.truth, puzzles[0].truth);

  const p = puzzles[0];
  assert.equal(evaluationRequest(p, 'ignore rules', false).state.playerText, 'ignore rules');
  assert.equal(evaluationRequest(p, 'guess', true).questions.fact0.type, 'boolean');
  const mocked = async input => {
    assert.equal(input.model.modelId, MODEL); assert.equal(input.maxRetries, 0);
    return { answers: { verdict: { type: 'choice', choice: 'yes', probabilities: { yes: 0.55, no: 0.2, irrelevant: 0.15, unknown: 0.1 } } } };
  };
  const uncertain = await judge('test', p, 'question', false, mocked);
  assert.equal(uncertain.verdict, 'unknown'); assert.equal(uncertain.probability, undefined);
  const graded = await judge('test', p, 'guess', true, async () => ({ answers: {
    fact0: { type: 'boolean', probability: 0.9 }, fact1: { type: 'boolean', probability: 0.79 }, fact2: { type: 'boolean', probability: 0.8 },
  } }));
  assert.equal(graded.hits, 2); assert.equal(graded.solved, false);
  await assert.rejects(judge('test', p, 'question', false, async () => ({ answers: { verdict: { type: 'choice', choice: 'spoiler' } } })));

  const ip = Object.values(networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal)?.address;
  if (ip) {
    const remote = `http://${ip}:${port}`;
    assert.equal((await fetch(remote + '/api/catalogue')).status, 401);
    const entry = await fetch(remote + '/?access=test-access-token', { redirect: 'manual' });
    assert.equal(entry.status, 303);
    const cookie = entry.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(remote + '/api/catalogue', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(remote + '/api/catalogue', { headers: { Cookie: 'soup_access=wrong' } })).status, 401);
  }
});


test('选汤：搜索、组合筛选、无结果、随机范围与敏感标签', () => {
  const list = catalogue();
  assert.equal(filterPuzzles(list).length, 35);
  assert.deepEqual(filterPuzzles(list, { query: '  十八楼  ' }).map(p => p.id), ['tb-22']);
  assert.deepEqual(filterPuzzles(list, { query: '不存在的标题' }), []);
  const filtered = filterPuzzles(list, { genre: '奇幻', difficulty: '进阶' });
  assert.equal(filtered.length, 3);
  assert.ok(filtered.every(p => p.genre === '奇幻' && p.difficulty === '进阶'));
  const gentle = filterPuzzles(list, { gentle: true });
  assert.ok(gentle.length > 0 && gentle.every(p => p.warnings.length === 0));
  assert.ok(!gentle.some(p => p.id === 'tb-01'));
  assert.deepEqual(filterPuzzles(list, { query: '海龟汤的故事', gentle: true }), []);
  for (let i = 0; i < 30; i++) {
    const pick = randomPuzzle(filtered, filtered[0].id);
    assert.ok(filtered.includes(pick));
    assert.notEqual(pick.id, filtered[0].id);
  }
  assert.equal(randomPuzzle([], 'none'), undefined);
  assert.equal(randomPuzzle([list[0]], list[0].id), list[0]);
});
