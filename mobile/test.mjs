import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGame, SAVE } from './game.js';
const puzzles = [...JSON.parse(await readFile(new URL('../data/originals.json', import.meta.url))), ...JSON.parse(await readFile(new URL('../data/turtlebench.json', import.meta.url)))];
test('本地游戏存档不泄露汤底或 Key', async () => { const data = new Map(), storage = { getItem: async k => data.get(k) ?? null, setItem: async (k,v) => data.set(k,v) }; const api = createGame(puzzles, storage, async () => 'secret-key'); const s = await api('session', { puzzleId: puzzles[0].id }); assert.equal(s.truth, undefined); const r = await api('action', { id: s.id, action: 'hint' }); assert.equal(r.hints, 1); assert(!data.get(SAVE).includes('secret-key')); assert(!data.get(SAVE).includes(puzzles[0].truth)); });
