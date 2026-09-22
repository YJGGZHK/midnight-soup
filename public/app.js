import { filterPuzzles, randomPuzzle } from './catalogue.js';
const $ = selector => document.querySelector(selector);
let catalogue = [], configured = false, session, busy = false, solving = false, questionPage = 0;
const storageKey = 'midnight-soup-session-v1';
function save(id) { try { localStorage.setItem(storageKey, id); } catch { /* 浏览器禁用存储时仍可玩当前局。 */ } }
function storedId() { try { return localStorage.getItem(storageKey); } catch { return null; } }
async function api(path, body) {
  if (window.MidnightSoup) return window.MidnightSoup.request(path, body);
  const response = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
  return data;
}
function error(message = '') { $('#error').textContent = message; $('#error').hidden = !message; }
function confirmAction(title, text) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }));
}
$('#confirm-no').onclick = () => $('#confirm-dialog').close('no');
$('#confirm-yes').onclick = () => $('#confirm-dialog').close('yes');
function puzzle() { return catalogue.find(p => p.id === session?.puzzleId) || catalogue[0]; }
function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function setBusy(value) {
  busy = value;
  $('#host-status').textContent = value ? '正在核对' : session?.ended ? '本局已结束' : configured ? '等你提问' : '请先配置 Key';
  controls();
}
function controls() {
  const ended = !session || session.ended;
  $('#question').disabled = busy || ended || !configured;
  $('#send').disabled = busy || ended || !configured || !$('#question').value.trim();
  $('#hint').disabled = busy || ended || session.hints >= 3;
  $('#solve').disabled = busy || ended || !configured;
  $('#reveal').disabled = busy || ended;
  $('#more-questions').disabled = busy || ended || solving;
  $('#open-library').disabled = busy || !catalogue.length;
  $('#random-puzzle').disabled = busy || !filteredPuzzles().length;
  for (const element of document.querySelectorAll('.puzzle-option, .suggestion')) element.disabled = busy || (element.classList.contains('suggestion') && (ended || !configured));
}
function filteredPuzzles() {
  return filterPuzzles(catalogue, {
    query: $('#puzzle-search').value, genre: $('#genre-filter').value,
    difficulty: $('#difficulty-filter').value, gentle: $('#gentle-filter').checked,
  });
}
function renderCatalogue() {
  const visible = filteredPuzzles();
  $('#library-count').textContent = `${visible.length} / ${catalogue.length} 道故事`;
  $('#library-empty').hidden = visible.length > 0;
  $('#random-puzzle').disabled = busy || !visible.length;
  $('#puzzle-list').replaceChildren(...visible.map(p => {
    const button = node('button', `puzzle-option${p.id === session?.puzzleId ? ' active' : ''}`);
    button.setAttribute('aria-pressed', String(p.id === session?.puzzleId));
    button.setAttribute('aria-label', `选择 ${p.title}`);
    button.append(node('span', 'puzzle-card-meta', `${p.genre} / ${p.difficulty} / ${p.time}`),
      node('h3', '', p.title), node('p', 'puzzle-teaser', p.teaser),
      node('span', 'puzzle-warnings', p.warnings.length ? `内容提示：${p.warnings.join(' · ')}` : '无敏感内容标签'),
      node('span', 'puzzle-source', p.source),
      node('span', 'arrow', p.id === session?.puzzleId ? '继续本局 ↗' : '选这碗 ↗'));
    button.disabled = busy;
    button.onclick = () => selectPuzzle(p.id);
    return button;
  }));
}
function openLibrary() {
  renderCatalogue();
  $('#library-dialog').showModal();
  $('#puzzle-search').focus();
}
async function selectPuzzle(id) {
  if (busy) return;
  if ((id === session?.puzzleId && !session.ended) || await changeGame(id)) {
    $('#library-dialog').close();
    $('#case-title').focus({ preventScroll: true });
    $('#game').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
$('#open-library').onclick = openLibrary;
$('#restart').onclick = openLibrary;
$('#puzzle-search').oninput = renderCatalogue;
for (const selector of ['#genre-filter', '#difficulty-filter', '#gentle-filter']) $(selector).onchange = renderCatalogue;
$('#clear-filters').onclick = () => {
  $('#puzzle-search').value = ''; $('#genre-filter').value = ''; $('#difficulty-filter').value = ''; $('#gentle-filter').checked = false;
  renderCatalogue(); $('#puzzle-search').focus();
};
$('#random-puzzle').onclick = () => {
  const selected = randomPuzzle(filteredPuzzles(), session?.puzzleId);
  if (selected) selectPuzzle(selected.id);
};
function renderMessages() {
  const log = $('#conversation');
  const welcome = node('article', 'message host');
  welcome.append(node('div', 'message-meta', '主持人 · 今夜开场'), node('p', '', !configured
    ? '请先点击右上角「连接 Jev」，填写服务端 .env 中的 Key 并刷新连接状态。\n配置后，所有提问与破案判断都由 Jev 完成。'
    : '欢迎入座。我只回答：是、不是、无关、无法确定。\n请每次问一件事；想好完整真相后，点「我要破案」。'));
  log.replaceChildren(welcome);
  for (const message of session.messages) {
    const card = node('article', `message ${message.role === 'player' ? 'player' : 'host'} ${message.kind}`);
    card.append(node('div', 'message-meta', message.role === 'player' ? (message.kind === 'solve' ? '你的推理' : '你') : (message.kind === 'hint' ? '一条小小的提示' : 'Jev · 模型判断')));
    const content = node('p', '');
    if (message.verdict) {
      content.append(node('span', `answer-word ${message.verdict}`, message.text));
      if (message.ms !== undefined) content.append(node('span', 'result-detail', `${(message.ms / 1000).toFixed(1)}s${message.probability == null ? '' : ' · ' + Math.round(message.probability * 100) + '% 概率'}`));
    } else content.textContent = message.text;
    card.append(content);
    log.append(card);
  }
  log.scrollTop = log.scrollHeight;
}
function renderSuggestions() {
  const p = puzzle();
  const questions = solving ? [] : p.questions.slice(questionPage * 3, questionPage * 3 + 3);
  $('#suggestions').replaceChildren(...questions.map(text => {
    const button = node('button', `suggestion${session.asked.includes(text) ? ' asked' : ''}`, text);
    button.onclick = () => act('ask', text);
    return button;
  }));
  $('#composer-title').textContent = solving ? '把线索串起来，说说你认为的真相' : '不知道从哪问起？试试这些';
  $('#more-questions').hidden = solving;
  $('#solve').textContent = solving ? '返回提问 ↶' : '我要破案 ↗';
  $('#question').placeholder = solving ? '事情为什么会发生？请尽量说明完整的因果关系…' : configured ? '问一个能用「是 / 不是」回答的问题…' : '请先连接 Jev，配置 Key 后即可提问。';
  $('#send').setAttribute('aria-label', solving ? '提交推理' : '发送问题');
  controls();
}
function render() {
  const p = puzzle();
  const index = catalogue.findIndex(item => item.id === p.id);
  $('#case-number').textContent = `CASE FILE / ${String(index + 1).padStart(3, '0')}`;
  $('#case-title').textContent = p.title;
  $('#case-tags').textContent = `${p.genre}  /  ${p.difficulty}  /  ${p.time}`;
  $('#surface').textContent = p.surface;
  $('.scene').hidden = p.id.startsWith('tb-');
  $('.scene').dataset.puzzle = p.id;
  $('#case-warning').textContent = p.warnings.length ? `内容提示：${p.warnings.join(' · ')}` : '';
  $('#case-warning').hidden = !p.warnings.length;
  $('#case-source').textContent = p.source;
  $('#selected-puzzle').textContent = p.title;
  $('#selected-description').textContent = p.teaser;
  $('.scene-caption').textContent = `STORY NO. ${String(index + 1).padStart(2, '0')} / ${p.teaser}`;
  $('.file-stamp').textContent = session.ended ? (session.solved ? '已破案' : '已揭晓') : '待解密';
  $('#turn-count').textContent = `${String(session.turns).padStart(2, '0')} 次提问`;
  $('#hint-count').textContent = `${session.hints}/3`;
  $('#ending').hidden = !session.ended;
  if (session.ended) {
    $('#ending-title').textContent = session.solved ? '破案了。你看见了故事的另一面。' : '揭开汤底，原来如此。';
    $('#truth').textContent = session.truth;
    $('#truth-source').textContent = `${session.source}。${session.adaptation}`;
    $('#recap').textContent = `${session.turns} 次提问与推理 · ${session.hints} 条提示 · Jev 裁判`;
  }
  renderCatalogue(); renderMessages(); renderSuggestions(); setBusy(busy);
}
async function start(id) {
  setBusy(true); error(); $('#library-status').textContent = '';
  try {
    const next = await api('session', { puzzleId: id });
    session = next; solving = false; questionPage = 0; $('#question').value = '';
    save(session.id); render(); return true;
  } catch (e) { error(e.message); $('#library-status').textContent = e.message; return false; }
  finally { setBusy(false); }
}
async function changeGame(id) {
  if (busy) return;
  if (session && !session.ended && (session.turns || session.hints)) {
    if (!await confirmAction('换一碗新的汤？', '当前这一局会重新开始，已获得的线索不会带到新的一局。')) return;
  }
  return start(id);
}
async function act(action, text) {
  if (busy || !session) return;
  setBusy(true); error();
  try {
    session = await api('action', { id: session.id, action, text });
    if (['ask', 'solve'].includes(action)) $('#connection-footer').textContent = 'Jev 已连接 · 模型判断仅供游戏参考';
    if (action === 'ask' || action === 'solve') $('#question').value = '';
    render();
    if (session.ended) $('#ending').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { error(e.message); }
  finally { setBusy(false); }
}
$('#more-questions').onclick = () => { questionPage = (questionPage + 1) % Math.ceil(puzzle().questions.length / 3); renderSuggestions(); };
$('#ask-form').onsubmit = event => { event.preventDefault(); if (!$('#send').disabled) act(solving ? 'solve' : 'ask', $('#question').value.trim()); };
$('#question').oninput = controls;
$('#question').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#ask-form').requestSubmit(); } };
$('#hint').onclick = () => act('hint');
$('#solve').onclick = () => {
  solving = !solving; $('#question').value = ''; renderSuggestions(); $('#question').focus();
};
$('#reveal').onclick = async () => { if (await confirmAction('确定要揭晓汤底吗？', '查看后会结束这一局。要不要再试着问一个问题？')) act('reveal'); };
$('#rules-button').onclick = () => $('#rules-dialog').showModal();
$('#settings-button').onclick = () => window.MidnightSoup ? api('settings') : $('#settings-dialog').showModal();
async function refreshConfig() {
  const data = await api('catalogue');
  catalogue = data.puzzles; configured = data.configured;
  $('#total-puzzles').textContent = `${catalogue.length} 道故事 / 自选一碗`;
  $('#footer-count').textContent = `${catalogue.length} 道汤`;
  for (const [selector, field, label] of [['#genre-filter', 'genre', '全部类型'], ['#difficulty-filter', 'difficulty', '全部难度']]) {
    const select = $(selector), previous = select.value;
    const all = node('option', '', label); all.value = '';
    const options = [...new Set(catalogue.map(p => p[field]))].map(value => { const option = node('option', '', value); option.value = value; return option; });
    select.replaceChildren(all, ...options); select.value = previous;
  }
  $('#settings-button').textContent = configured ? 'Jev 已配置 ↗' : '连接 Jev ↗';
  $('#connection-footer').textContent = configured ? 'Jev Key 已配置 · 连接待实测' : '尚未配置 Jev Key';
  $('#settings-status').textContent = configured ? '已读取 Key。关闭此窗口即可提问，首个问题将验证真实连接。' : '尚未读取到 Key。请填写 .env 并保存。';
}
$('#refresh-config').onclick = async () => {
  const button = $('#refresh-config'); button.disabled = true;
  try { await refreshConfig(); if (session) render(); }
  catch (e) { $('#settings-status').textContent = e.message; }
  finally { button.disabled = false; }
};
try {
  await refreshConfig();
  const id = storedId();
  if (window.MidnightSoup) session = await api('resume');
  else if (id) {
    try { session = await api(`session?id=${encodeURIComponent(id)}`); }
    catch (e) { error(e.message); }
  }
  if (session) render();
  else await start(catalogue[0].id);
} catch (e) { error(e.message); }
