/* 数学分析讲义 · 交互学习 */
(() => {
'use strict';

const DATA = window.DATA;
const ITEMS = DATA.items;
const BY_ID = new Map(ITEMS.map(i => [i.id, i]));
const FORMAL = ITEMS.filter(i => i.type === 'theorem');
const PROBS = ITEMS.filter(i => i.type === 'problem');
const CHAPTERS = DATA.chapters;
const SECTIONS = CHAPTERS.flatMap(c => c.sections.map(s => ({...s, chapter: c.num, chapterTitle: c.title})));
const SECMAP = new Map(SECTIONS.map(s => [s.num, s]));
const CHMAP = new Map(CHAPTERS.map(c => [c.num, c]));
const KIND_ORDER = {'定义':1,'定理':2,'推论':3,'引理':4};
const app = document.getElementById('app');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const LS = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
let bookmarks = new Set(LS.get('ma-bookmarks', []));
let viewed = new Set(LS.get('ma-viewed', []));
let visitedSections = new Set(LS.get('ma-sections', []));
let recent = LS.get('ma-recent', []);
let currentRoute = '';
let graphRAF = 0;

/* ---------------- utils ---------------- */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hi(text, q){
  const t = esc(text);
  if(!q) return t;
  try {
    return t.replace(new RegExp('(' + escRe(esc(q)) + ')', 'gi'), '<mark>$1</mark>');
  } catch(e){ return t; }
}
function plain(t){
  return String(t || '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?，。；：！？])/g, '$1').trim();
}
function statement(it, max = 260){
  let t = plain(it.text);
  const proofAt = t.indexOf('证明');
  if(it.type === 'theorem' && proofAt > 12) t = t.slice(0, proofAt);
  return t.length > max ? t.slice(0, max) + '…' : t;
}
function readPreview(it, max = 150){
  let t = plain(it.text).replace(/^(例|习题)\s*[0-9.]+\s*/, '');
  const bad = (t.match(/[□�]/g) || []).length;
  const sym = (t.match(/[A-Za-z0-9=+\-*/^_<>≤≥∈∞√∑∫{}[\]().,·…]/g) || []).length;
  if(bad > 0 || sym / Math.max(1, t.length) > 0.45) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}
function problemHead(p){
  if(p.kind === '例') return `例 ${p.num}`;
  return `第 ${p.num} 题`;
}
function problemTitle(p){
  if(p.kind === '例') return `例 ${p.num}`;
  return `${p.eg || '习题'} · 第 ${p.num} 题`;
}
function searchSub(it, q){
  const tags = (it.tags || []).slice(0,2).join(' / ');
  if(it.type === 'theorem') return `${it.sectionTitle} · ${tags}`;
  const rp = readPreview(it, 46);
  return `${it.sectionTitle} · ${rp || tags || '综合'}`;
}
function badge(it){
  if(it.comp) return '<span class="badge k-综合">综合</span>';
  return `<span class="badge k-${it.kind}">${it.kind}</span>`;
}
function typeOf(it){ return it.type; }
function itemHref(it){ return it.type === 'theorem' ? `#/thm/${it.id}` : `#/problem/${it.id}`; }
function kindLabel(it){ return it.kind + (it.num ? ' ' + it.num : ''); }
function isBookmarked(id){ return bookmarks.has(id); }
function saveBookmarks(){ LS.set('ma-bookmarks', Array.from(bookmarks)); }
function pushRecent(id){
  recent = [id, ...recent.filter(x => x !== id)].slice(0, 8);
  LS.set('ma-recent', recent);
}
function markViewed(id){
  if(!viewed.has(id)){ viewed.add(id); LS.set('ma-viewed', Array.from(viewed)); }
}
function markSection(num){
  if(!visitedSections.has(num)){ visitedSections.add(num); LS.set('ma-sections', Array.from(visitedSections)); }
}
function toast(msg){
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 1800);
}
function go(path){ if(location.hash === '#' + path) render(); else location.hash = path; }
function route(){
  let h = location.hash.replace(/^#/, '') || '/';
  let [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return {parts, q: new URLSearchParams(qs || '')};
}
function sectionOf(it){ return SECMAP.get(it.section); }
function chapterOf(it){ return CHMAP.get(it.chapter); }

/* ---------------- search ---------------- */
function scoreItem(it, q){
  if(!q) return 0;
  const ql = q.toLowerCase();
  const label = (it.label || '').toLowerCase();
  const title = (it.title || '').toLowerCase();
  const tags = (it.tagsText || '').toLowerCase();
  const text = (it.text || '').toLowerCase();
  let s = 0;
  if(label === ql) s += 120;
  if(label.includes(ql)) s += 70;
  if(title.includes(ql)) s += 55;
  if(tags.includes(ql)) s += 30;
  if(text.includes(ql)) s += 12;
  if(it.section === ql) s += 20;
  return s;
}
function searchItems(list, q, limit = 7){
  if(!q) return [];
  return list.map(it => [it, scoreItem(it, q)]).filter(x => x[1] > 0)
    .sort((a,b) => b[1] - a[1] || a[0].page - b[0].page)
    .slice(0, limit).map(x => x[0]);
}
function snippet(it, q, len = 74){
  let t = plain(it.text);
  let i = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if(i > 34) t = '…' + t.slice(i - 26);
  if(t.length > len) t = t.slice(0, len) + '…';
  return hi(t, q);
}

/* ---------------- chapter nav ---------------- */
function renderSidebar(){
  const nav = $('#chapter-nav');
  const r = route();
  const activeChapter = r.parts[0] === 'section' ? (SECMAP.get(r.parts[1]) || {}).chapter
    : r.parts[0] === 'chapter' ? r.parts[1]
    : r.parts[0] === 'thm' || r.parts[0] === 'problem' ? (BY_ID.get(r.parts[1]) || {}).chapter : null;
  const activeSection = r.parts[0] === 'section' ? r.parts[1]
    : r.parts[0] === 'thm' || r.parts[0] === 'problem' ? (BY_ID.get(r.parts[1]) || {}).section : null;
  nav.innerHTML = CHAPTERS.map(ch => `
    <details ${activeChapter === ch.num ? 'open' : ''}>
      <summary>
        <span class="ch-num">${ch.num}</span>
        <span class="ch-name">${esc(ch.title)}</span>
        <span class="ch-meta">${ch.stats.theorems}·${ch.stats.problems}</span>
      </summary>
      <div class="sec-links">
        ${ch.sections.map(s => `<a href="#/section/${s.num}" class="${activeSection === s.num ? 'active' : ''}">
          <span class="sec-num">${s.num}</span><span>${esc(s.title)}</span></a>`).join('')}
      </div>
    </details>`).join('');
  $('#count-thm').textContent = FORMAL.length;
  $('#count-prob').textContent = PROBS.length;
  $$('.side-link').forEach(a => a.classList.remove('active'));
  const v = r.parts[0] || 'home';
  const navMap = {theorems:'theorems', problems:'problems', graph:'graph', bookmarks:'bookmarks'};
  if(v === 'home' || !v) $('.side-link[data-nav="home"]')?.classList.add('active');
  else if(navMap[v]) $(`.side-link[data-nav="${navMap[v]}"]`)?.classList.add('active');
  else if(['section','chapter','thm','problem'].includes(v)){
    const sec = r.parts[0] === 'section' ? r.parts[1] : (BY_ID.get(r.parts[1]) || {}).section;
    if(sec) $(`.sec-links a[href="#/section/${sec}"]`)?.classList.add('active');
  }
}

/* ---------------- cards ---------------- */
function theoremCard(it, opts = {}){
  const rel = (it.relatedProblems || []).length;
  let excerpt = statement(it, opts.short ? 110 : 180);
  if(/[□�]/.test(excerpt)) excerpt = '';
  return `<a class="card thm-card" href="#/thm/${it.id}" data-item-id="${it.id}" data-item-type="theorem">
    <div class="card-top">${badge(it)}<span class="card-label">${esc(it.label)}</span><span class="card-page">p.${it.bookPage || it.page}</span></div>
    <h3>${hi(it.title || it.label, opts.q)}</h3>
    ${excerpt ? `<p class="excerpt">${hi(excerpt, opts.q)}</p>` : ''}
    <div class="tags">${(it.tags || []).slice(0,3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="card-foot"><span><span class="rel-count">${rel}</span> 道关联题</span><span class="go">→</span></div>
  </a>`;
}
function theoremChips(it, max = 3){
  const rel = it.relatedTheorems || [];
  if(!rel.length) return '';
  return `<div class="mini-thm">${rel.slice(0, max).map(r => {
    const t = BY_ID.get(r.id); if(!t) return '';
    return `<a href="#/thm/${t.id}">${esc(t.label)} ${esc(t.title.slice(0,10))}</a>`;
  }).join('')}</div>`;
}
function problemCard(it, opts = {}){
  const rp = readPreview(it, opts.short ? 90 : 150);
  return `<div class="card problem-card" data-item-id="${it.id}" data-item-type="problem">
    <div class="pthumb"><img src="${esc(it.img)}" loading="lazy" alt="${esc(it.label)} 原文预览"></div>
    <div class="card-top">${badge(it)}<span class="card-label">${esc(it.label)}</span><span class="card-page">p.${it.bookPage || it.page}</span></div>
    ${rp ? `<p class="excerpt" style="margin-top:2px">${hi(rp, opts.q)}</p>` : `<div class="ptags">${(it.tags || []).slice(0,3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`}
    ${theoremChips(it, 2)}
    <div class="card-foot"><span>${it.kind === '例' ? '典型例题' : (it.difficulty === 3 ? '难度 ★★★' : it.difficulty === 2 ? '难度 ★★' : '难度 ★')}</span><span class="go">查看 →</span></div>
  </div>`;
}
function probRow(it, opts = {}){
  const rel = it.relatedTheorems || [];
  const rp = readPreview(it, 160);
  return `<div class="prob-row" data-item-id="${it.id}" data-item-type="problem">
    <div class="pr-label">${badge(it)}<b>${esc(it.kind === '例' ? '例 ' + it.num : (it.eg || '习题'))}</b>${it.kind === '习题' ? '<span>第 ' + it.num + ' 题</span>' : ''}<span class="pr-page">p.${it.bookPage || it.page}</span></div>
    <div class="pr-body">${rp ? `<div class="pr-text">${hi(rp, opts.q)}</div>` : ''}<div class="pr-kw">考点 · ${(it.tags || []).join(' / ') || '综合'}</div></div>
    <div class="pr-links">${rel.slice(0,3).map(r => { const t = BY_ID.get(r.id); return t ? `<a href="#/thm/${t.id}">${esc(t.label)}</a>` : ''; }).join('')}</div>
  </div>`;
}

/* ---------------- home ---------------- */
function renderHome(){
  const stats = DATA.meta.stats;
  const core = ['thm-1-11','thm-1-13','thm-1-7','thm-1-38','thm-2-11','thm-2-14','thm-3-15','thm-3-21','thm-3-33']
    .map(id => BY_ID.get(id)).filter(Boolean);
  const recentItems = recent.map(id => BY_ID.get(id)).filter(Boolean).slice(0, 4);
  app.innerHTML = `
  <section class="hero">
    <div class="hero-kicker">MATHEMATICAL ANALYSIS · INTERACTIVE INDEX</div>
    <h1>把定理与题目<br>织成一张<em>知识网络</em></h1>
    <p class="hero-sub">以程艺、陈卿、李平《数学分析讲义》第一册第 1–3 章为底本，整理 ${FORMAL.length} 条定义·定理·推论，${PROBS.length} 道例题与习题。每条定理可跳到相关题目，每道题可回溯所用定理；支持定理、题目双通道搜索。</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="#/section/1.1">开始学习 <span>→</span></a>
      <a class="btn btn-accent" href="#/graph">打开知识图谱</a>
      <a class="btn btn-ghost" href="#/theorems">浏览定理索引</a>
      <span class="hero-note">快捷键：<kbd>/</kbd> 定理 · <kbd>P</kbd> 题目</span>
    </div>
  </section>

  <div class="stat-grid">
    <div class="stat"><div class="stat-num">${stats.chapters}<small>章</small></div><div class="stat-label">覆盖范围 · 第 1–3 章</div></div>
    <div class="stat"><div class="stat-num">${stats.theorems}<small>条</small></div><div class="stat-label">定义 · 定理 · 推论 · 引理</div></div>
    <div class="stat"><div class="stat-num">${stats.problems}<small>道</small></div><div class="stat-label">例题与课后习题</div></div>
    <div class="stat"><div class="stat-num">${stats.edges}<small>条</small></div><div class="stat-label">定理与题目的双向关联</div></div>
  </div>

  <div class="sec-head"><h2>三章内容 <span class="count">CHAPTERS</span></h2><a class="more" href="#/theorems">定理总览 →</a></div>
  <div class="chapter-grid">
    ${CHAPTERS.map(ch => {
      const total = ch.sections.length;
      const seen = ch.sections.filter(s => visitedSections.has(s.num)).length;
      const pct = total ? Math.round(seen / total * 100) : 0;
      return `<a class="chapter-card" href="#/chapter/${ch.num}">
        <div class="cc-num">0${ch.num}</div>
        <h3>${esc(ch.title)}</h3>
        <div class="cc-sub">${esc(ch.sub)}</div>
        <p class="cc-desc">${esc(ch.intro)}</p>
        <div class="cc-foot"><span>${ch.stats.theorems} 条定理 · ${ch.stats.problems} 道题</span><span>${pct}%</span></div>
        <div class="cc-bar"><i style="width:${pct}%"></i></div>
      </a>`;
    }).join('')}
  </div>

  <div class="sec-head"><h2>核心定理 <span class="count">CORE THEOREMS</span></h2><a class="more" href="#/theorems">全部 ${FORMAL.length} 条 →</a></div>
  <div class="grid">${core.map(it => theoremCard(it, {short:true})).join('')}</div>

  <div class="sec-head"><h2>使用方式 <span class="count">HOW TO USE</span></h2></div>
  <div class="chapter-grid">
    <div class="chapter-card" style="cursor:default;min-height:auto">
      <h3 style="font-size:16px">① 先建框架</h3>
      <p class="cc-desc" style="margin-bottom:0">按章节目录顺序阅读，先看每节的“定义 · 定理”卡片，建立概念与结论的骨架。</p>
    </div>
    <div class="chapter-card" style="cursor:default;min-height:auto">
      <h3 style="font-size:16px">② 定理找题</h3>
      <p class="cc-desc" style="margin-bottom:0">在定理详情页查看“可应对的题目”，用同一结论横向刷不同题型，理解适用范围。</p>
    </div>
    <div class="chapter-card" style="cursor:default;min-height:auto">
      <h3 style="font-size:16px">③ 题目找定理</h3>
      <p class="cc-desc" style="margin-bottom:0">做题时先看题目关联的定理，再回到定理原文；也可用双搜索框直接定位关键词。</p>
    </div>
  </div>
  ${recentItems.length ? `<div class="sec-head"><h2>最近浏览 <span class="count">RECENT</span></h2></div>
  <div class="recent-grid">${recentItems.map(it => `<a class="recent-item" href="${itemHref(it)}"><b>${esc(it.kind)}</b><span>${esc(it.label)} ${esc(it.title || '')}</span></a>`).join('')}</div>` : ''}
  ${footer()}`;
}

function footer(){
  return `<footer class="app-footer"><span>${esc(DATA.meta.source)} · ${esc(DATA.meta.edition)}</span><span>公式细节以教材原文为准 · 原图可点击放大</span></footer>`;
}

/* ---------------- chapter ---------------- */
function renderChapter(num){
  const ch = CHMAP.get(num);
  if(!ch) return renderNotFound();
  app.innerHTML = `
  <div class="breadcrumb"><a href="#/">概览</a><span>/</span><span>第 ${ch.num} 章</span></div>
  <section class="sec-hero">
    <div class="sh-num">CHAPTER ${ch.num}</div>
    <h1>${esc(ch.title)}</h1>
    <p class="sh-intro">${esc(ch.intro)}</p>
    <div class="sh-meta"><span>定理 <b>${ch.stats.theorems}</b></span><span>题目 <b>${ch.stats.problems}</b></span><span>小节 <b>${ch.sections.length}</b></span></div>
  </section>
  <div class="sec-head"><h2>本章小节 <span class="count">SECTIONS</span></h2></div>
  <div class="chapter-grid">
    ${ch.sections.map(s => `<a class="chapter-card" href="#/section/${s.num}">
      <div class="cc-num">${s.num}</div>
      <h3 style="font-size:17px">${esc(s.title)}</h3>
      <p class="cc-desc">${esc(s.intro)}</p>
      <div class="cc-foot"><span>${s.stats.theorems} 条定理 · ${s.stats.problems} 道题</span><span>进入 →</span></div>
    </a>`).join('')}
  </div>
  <div class="detail-section"><h2>本章定理速览 <span>${ch.stats.theorems}</span></h2>
    <div class="grid">${FORMAL.filter(it => it.chapter === ch.num).map(it => theoremCard(it, {short:true})).join('')}</div>
  </div>
  ${footer()}`;
}

/* ---------------- section ---------------- */
function renderSection(num, q = new URLSearchParams()){
  const sec = SECMAP.get(num);
  if(!sec) return renderNotFound();
  markSection(num);
  const ch = CHMAP.get(sec.chapter);
  const thms = FORMAL.filter(i => i.section === num);
  const allProbs = PROBS.filter(i => i.section === num);
  const ptype = q.get('type') || '全部';
  const probs = allProbs.filter(p => ptype === '全部' || (ptype === '例题' ? p.kind === '例' : p.kind === '习题'));
  const idx = SECTIONS.findIndex(s => s.num === num);
  const prev = SECTIONS[idx - 1], next = SECTIONS[idx + 1];
  app.innerHTML = `
  <div class="breadcrumb"><a href="#/">概览</a><span>/</span><a href="#/chapter/${ch.num}">第 ${ch.num} 章 ${esc(ch.title)}</a><span>/</span><span>${num}</span></div>
  <section class="sec-hero">
    <div class="sh-num">§ ${num}</div>
    <h1>${esc(sec.title)}</h1>
    <p class="sh-intro">${esc(sec.intro)}</p>
    <div class="sh-meta"><span>定理 <b>${thms.length}</b></span><span>题目 <b>${probs.length}</b></span><span>教材 p.<b>${thms[0]?.bookPage || probs[0]?.bookPage || '—'}</b></span></div>
    <div class="sec-navline">
      ${ch.sections.map(s => `<a href="#/section/${s.num}" class="${s.num === num ? 'active' : ''}">${s.num} ${esc(s.title)}</a>`).join('')}
    </div>
  </section>

  <div class="sec-head"><h2>本节定理 <span class="count">DEFINITIONS & THEOREMS</span></h2><span class="more" style="color:var(--ink-3)">点击卡片查看关联题目</span></div>
  ${thms.length ? `<div class="grid">${thms.map(it => theoremCard(it)).join('')}</div>` : `<div class="empty">本节暂无单独编号的定理。</div>`}

  <div class="sec-head"><h2>本节题目 <span class="count">EXAMPLES & EXERCISES</span></h2><span class="more" style="color:var(--ink-3)">${probs.filter(p => p.kind === '例').length} 道例题 · ${probs.filter(p => p.kind === '习题').length} 道习题</span></div>
  <div class="sec-filter">
    ${['全部','例题','习题'].map(t => `<a class="chip ${ptype===t?'active':''}" href="#/section/${num}${t==='全部'?'':'?type='+encodeURIComponent(t)}">${t}<span style="opacity:.55"> ${t==='全部'?allProbs.length:t==='例题'?allProbs.filter(p=>p.kind==='例').length:allProbs.filter(p=>p.kind==='习题').length}</span></a>`).join('')}
  </div>
  ${probs.length ? `<div class="prob-list">${probs.map(p => probRow(p)).join('')}</div>` : `<div class="empty">本节暂无题目。</div>`}

  <div class="sec-head"><h2>继续阅读 <span class="count">NAVIGATION</span></h2></div>
  <div class="chapter-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
    ${prev ? `<a class="chapter-card" href="#/section/${prev.num}" style="min-height:auto"><div class="cc-sub">← 上一节</div><h3 style="font-size:17px">${prev.num} ${esc(prev.title)}</h3></a>` : ''}
    ${next ? `<a class="chapter-card" href="#/section/${next.num}" style="min-height:auto;text-align:right"><div class="cc-sub">下一节 →</div><h3 style="font-size:17px">${next.num} ${esc(next.title)}</h3></a>` : ''}
  </div>
  ${footer()}`;
}

/* ---------------- library: theorems ---------------- */
function renderTheorems(q){
  const kind = q.get('kind') || '全部';
  const chapter = q.get('chapter') || '全部';
  const search = q.get('q') || '';
  let list = FORMAL.filter(it =>
    (kind === '全部' || it.kind === kind) &&
    (chapter === '全部' || it.chapter === chapter) &&
    (!search || scoreItem(it, search) > 0)
  );
  if(search) list.sort((a,b) => scoreItem(b,search) - scoreItem(a,search) || a.page - b.page);
  else list.sort((a,b) => a.chapter - b.chapter || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.num.localeCompare(b.num, undefined, {numeric:true}));
  const kinds = ['全部','定义','定理','推论','引理'];
  const qlink = (p) => '#/theorems?' + new URLSearchParams(p).toString();
  app.innerHTML = `
  <div class="breadcrumb"><a href="#/">概览</a><span>/</span><span>定理索引</span></div>
  <div class="sec-head"><h2>定理索引 <span class="count">${FORMAL.length} 条定义·定理·推论</span></h2></div>
  <div class="toolbar">
    <span class="tb-label">类型</span>
    ${kinds.map(k => `<a class="chip ${kind === k ? 'active' : ''}" href="${qlink({kind:k, ...(chapter!=='全部'?{chapter}:{}) , ...(search?{q:search}:{})})}">${k}</a>`).join('')}
    <span class="tb-label" style="margin-left:6px">章节</span>
    <select class="tb-select" data-sel="chapter" aria-label="按章节筛选">
      <option value="全部">全部章节</option>
      ${CHAPTERS.map(c => `<option value="${c.num}" ${chapter===c.num?'selected':''}>第 ${c.num} 章 · ${esc(c.title)}</option>`).join('')}
    </select>
    ${search ? `<a class="chip" href="${qlink({kind, ...(chapter!=='全部'?{chapter}:{})})}">清除搜索 ×</a>` : ''}
    <span class="tb-spacer"></span>
    <label class="tb-search"><span style="color:var(--ink-3)">⌕</span><input id="lib-search" type="search" value="${esc(search)}" placeholder="在本页筛选…"></label>
    <span class="tb-count">共 ${list.length} 条</span>
  </div>
  ${list.length ? `<div class="grid">${list.map(it => theoremCard(it, {q:search})).join('')}</div>` : `<div class="empty"><b>没有找到匹配的定理</b>换一个关键词，或清除筛选条件。</div>`}
  ${footer()}`;
  const sel = $('[data-sel="chapter"]');
  sel?.addEventListener('change', e => {
    const p = {kind}; if(e.target.value !== '全部') p.chapter = e.target.value; if(search) p.q = search;
    go('#/theorems?' + new URLSearchParams(p).toString());
  });
  bindLibSearch(search, kind, chapter, 'theorems');
}
function bindLibSearch(search, kind, chapter, mode){
  const input = $('#lib-search');
  if(!input) return;
  input.addEventListener('keydown', e => {
    if(e.key !== 'Enter') return;
    const p = {}; if(kind && kind !== '全部') p.kind = kind;
    if(chapter && chapter !== '全部') p.chapter = chapter;
    if(input.value.trim()) p.q = input.value.trim();
    go(`#/${mode}?` + new URLSearchParams(p).toString());
  });
}

/* ---------------- library: problems ---------------- */
function renderProblems(q){
  const kind = q.get('kind') || '全部';
  const chapter = q.get('chapter') || '全部';
  const section = q.get('section') || '全部';
  const diff = q.get('diff') || '全部';
  const search = q.get('q') || '';
  const kindKey = kind === '例题' ? '例' : kind;
  let list = PROBS.filter(it =>
    (kind === '全部' || it.kind === kindKey) &&
    (chapter === '全部' || it.chapter === chapter) &&
    (section === '全部' || it.section === section) &&
    (diff === '全部' || String(it.difficulty) === diff) &&
    (!search || scoreItem(it, search) > 0)
  );
  if(search) list.sort((a,b) => scoreItem(b,search) - scoreItem(a,search) || a.page - b.page);
  else list.sort((a,b) => a.chapter - b.chapter || a.section.localeCompare(b.section, undefined, {numeric:true}) || (a.kind === '例' ? 0 : 1) - (b.kind === '例' ? 0 : 1) || (+a.num) - (+b.num));
  const qlink = (p) => '#/problems?' + new URLSearchParams(p).toString();
  const chapSections = SECTIONS.filter(s => chapter === '全部' || s.chapter === chapter);
  app.innerHTML = `
  <div class="breadcrumb"><a href="#/">概览</a><span>/</span><span>题目索引</span></div>
  <div class="sec-head"><h2>题目索引 <span class="count">${PROBS.length} 道例题与习题</span></h2></div>
  <div class="toolbar">
    <span class="tb-label">类型</span>
    ${['全部','例题','习题'].map(k => `<a class="chip ${kind === k ? 'active' : ''}" href="${qlink({kind:k, ...(chapter!=='全部'?{chapter}:{}) , ...(search?{q:search}:{})})}">${k}</a>`).join('')}
    <span class="tb-label" style="margin-left:6px">章节</span>
    <select class="tb-select" data-sel="chapter" aria-label="按章节筛选">
      <option value="全部">全部章节</option>
      ${CHAPTERS.map(c => `<option value="${c.num}" ${chapter===c.num?'selected':''}>第 ${c.num} 章 · ${esc(c.title)}</option>`).join('')}
    </select>
    <select class="tb-select" data-sel="section" aria-label="按小节筛选">
      <option value="全部">全部小节</option>
      ${chapSections.map(s => `<option value="${s.num}" ${section===s.num?'selected':''}>${s.num} ${esc(s.title)}</option>`).join('')}
    </select>
    <select class="tb-select" data-sel="diff" aria-label="按难度筛选">
      <option value="全部">全部难度</option>
      <option value="1" ${diff==='1'?'selected':''}>★ 基础</option>
      <option value="2" ${diff==='2'?'selected':''}>★★ 常规</option>
      <option value="3" ${diff==='3'?'selected':''}>★★★ 综合</option>
    </select>
    ${search ? `<a class="chip" href="${qlink({kind, ...(chapter!=='全部'?{chapter}:{}) , ...(section!=='全部'?{section}:{})})}">清除搜索 ×</a>` : ''}
    <span class="tb-spacer"></span>
    <label class="tb-search"><span style="color:var(--ink-3)">⌕</span><input id="lib-search" type="search" value="${esc(search)}" placeholder="在本页筛选…"></label>
    <span class="tb-count">共 ${list.length} 道</span>
  </div>
  ${list.length ? `<div class="prob-list">${list.map(it => probRow(it, {q:search})).join('')}</div>` : `<div class="empty"><b>没有找到匹配的题目</b>试试更短的关键词，或切换章节。</div>`}
  ${footer()}`;
  const params = () => {
    const p = {}; if(kind!=='全部') p.kind = kind; if(chapter!=='全部') p.chapter = chapter;
    if(section!=='全部') p.section = section; if(diff!=='全部') p.diff = diff; if(search) p.q = search; return p;
  };
  $$('[data-sel]').forEach(sel => sel.addEventListener('change', e => {
    const p = params();
    if(e.target.dataset.sel === 'chapter'){ p.chapter = e.target.value; delete p.section; }
    else p[e.target.dataset.sel] = e.target.value;
    if(p.chapter === '全部') delete p.chapter;
    if(p.section === '全部') delete p.section;
    if(p.diff === '全部') delete p.diff;
    go('#/problems?' + new URLSearchParams(p).toString());
  }));
  bindLibSearch(search, kind, chapter, 'problems');
}

/* ---------------- detail ---------------- */
function renderTheoremDetail(id){
  const it = BY_ID.get(id);
  if(!it || it.type !== 'theorem') return renderNotFound();
  markViewed(id); pushRecent(id);
  const sec = sectionOf(it);
  const relRaw = it.relatedProblems || [];
  const relProbs = relRaw.map(r => BY_ID.get(r.id)).filter(Boolean);
  const allFallback = relRaw.length > 0 && relRaw.every(r => r.fallback);
  const thms = FORMAL.filter(t => t.section === it.section).sort((a,b) => a.num.localeCompare(b.num, undefined, {numeric:true}));
  const idx = thms.findIndex(t => t.id === id);
  const prev = thms[idx - 1], next = thms[idx + 1];
  const bookmark = isBookmarked(id);
  app.innerHTML = `
  <div class="detail">
    <a class="backlink" href="#/section/${it.section}">← 返回 ${it.section} ${esc(it.sectionTitle)}</a>
    <div class="detail-head">${badge(it)}<span class="card-label">${esc(it.label)}</span><span class="card-page">教材 p.${it.bookPage || it.page} · PDF ${it.page}</span></div>
    <h1>${esc(it.title || it.label)}</h1>
    <div class="detail-tags">${(it.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="detail-grid">
      <div>
        <figure class="paper-figure">
          ${(it.images && it.images.length ? it.images : [{src:it.img}]).map((im,ii) => `<img src="${esc(im.src)}" alt="${esc(it.label)} 教材原文 ${ii+1}" data-zoom="${esc(im.src)}" loading="eager">`).join('')}
          <figcaption><span>${esc(it.label)} · ${esc(it.sectionTitle)}${(it.images||[]).length>1?` · 共 ${it.images.length} 页`:''}</span><span class="zoom-hint">点击放大 / 滚轮缩放</span></figcaption>
        </figure>
        <details class="detail-text"><summary>文字版（自动提取，公式以原图为准）</summary><pre>${esc(it.text)}</pre></details>
      </div>
      <aside class="detail-side">
        <div class="side-card">
          <h4>条目信息 <span>INFO</span></h4>
          <div class="kv"><span>类型</span><b>${esc(it.kind)}</b></div>
          <div class="kv"><span>编号</span><b>${esc(it.label)}</b></div>
          <div class="kv"><span>位置</span><b>${esc(it.chapterTitle)} · ${esc(it.sectionTitle)}</b></div>
          <div class="kv"><span>教材页码</span><b>p.${it.bookPage || it.page}</b></div>
          <div class="kv"><span>PDF 原文</span><b><a href="assets/textbook.pdf#page=${it.page}" target="_blank" rel="noopener" style="color:var(--accent)">第 ${it.page} 页 ↗</a></b></div>
          <div class="kv"><span>关联题目</span><b>${relProbs.length} 道</b></div>
          <div class="side-actions">
            <button class="btn ${bookmark ? 'btn-accent' : ''}" id="bookmark-btn">${bookmark ? '★ 已收藏' : '☆ 收藏'}</button>
            <a class="btn" href="#/graph?focus=${it.id}">图谱定位</a>
          </div>
        </div>
        <div class="side-card">
          <h4>相邻定理 <span>NEARBY</span></h4>
          <div class="rel-list">
            ${prev ? `<div class="rel-item"><span class="ri-id">${esc(prev.label)}</span><a href="#/thm/${prev.id}">${esc(prev.title)}</a></div>` : ''}
            ${next ? `<div class="rel-item"><span class="ri-id">${esc(next.label)}</span><a href="#/thm/${next.id}">${esc(next.title)}</a></div>` : ''}
            ${!prev && !next ? '<div class="rel-item" style="color:var(--ink-3)">本节只有这一条。</div>' : ''}
          </div>
        </div>
      </aside>
    </div>

    <section class="detail-section">
      <h2>${allFallback ? '同节相关题目' : '可应对的题目'} <span>${relProbs.length} 道 · ${allFallback ? '暂无直接标注，以下为同节题目' : '点击题目查看所用定理'}</span></h2>
      ${relProbs.length ? `<div class="rel-detail-grid">${relProbs.map(p => problemCard(p, {short:true})).join('')}</div>` : `<div class="empty">暂未关联题目。</div>`}
    </section>
    ${footer()}
  </div>`;
  $('#bookmark-btn')?.addEventListener('click', () => toggleBookmark(id));
}

function renderProblemDetail(id){
  const it = BY_ID.get(id);
  if(!it || it.type !== 'problem') return renderNotFound();
  markViewed(id); pushRecent(id);
  const relThms = (it.relatedTheorems || []).map(r => BY_ID.get(r.id)).filter(Boolean);
  const same = PROBS.filter(p => p.section === it.section && p.id !== it.id).slice(0, 6);
  const bookmark = isBookmarked(id);
  app.innerHTML = `
  <div class="detail">
    <a class="backlink" href="#/section/${it.section}">← 返回 ${it.section} ${esc(it.sectionTitle)}</a>
    <div class="detail-head">${badge(it)}<span class="card-label">${esc(it.label)}</span><span class="card-page">教材 p.${it.bookPage || it.page} · PDF ${it.page}</span></div>
    <h1>${esc(problemTitle(it))}</h1>
    <div class="detail-tags">${(it.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">${it.kind === '例' ? '典型例题' : '课后习题'}</span><span class="tag">难度 ${'★'.repeat(it.difficulty)}</span></div>
    <div class="detail-grid">
      <div>
        <figure class="paper-figure">
          ${(it.images && it.images.length ? it.images : [{src:it.img}]).map((im,ii) => `<img src="${esc(im.src)}" alt="${esc(it.label)} 教材原文 ${ii+1}" data-zoom="${esc(im.src)}" loading="eager">`).join('')}
          <figcaption><span>${esc(it.label)} · ${esc(it.sectionTitle)}${(it.images||[]).length>1?` · 共 ${it.images.length} 页`:''}</span><span class="zoom-hint">点击放大 / 滚轮缩放</span></figcaption>
        </figure>
        <details class="detail-text"><summary>文字版（自动提取，公式以原图为准）</summary><pre>${esc(it.text)}</pre></details>
      </div>
      <aside class="detail-side">
        <div class="side-card">
          <h4>本题信息 <span>INFO</span></h4>
          <div class="kv"><span>类型</span><b>${it.kind === '例' ? '例题' : '习题'}</b></div>
          <div class="kv"><span>题号</span><b>${esc(it.label)}</b></div>
          <div class="kv"><span>位置</span><b>${esc(it.chapterTitle)} · ${esc(it.sectionTitle)}</b></div>
          <div class="kv"><span>教材页码</span><b>p.${it.bookPage || it.page}</b></div>
          <div class="kv"><span>PDF 原文</span><b><a href="assets/textbook.pdf#page=${it.page}" target="_blank" rel="noopener" style="color:var(--accent)">第 ${it.page} 页 ↗</a></b></div>
          <div class="kv"><span>关联定理</span><b>${relThms.length} 条</b></div>
          <div class="side-actions">
            <button class="btn ${bookmark ? 'btn-accent' : ''}" id="bookmark-btn">${bookmark ? '★ 已收藏' : '☆ 收藏'}</button>
            <a class="btn" href="#/problems?section=${it.section}">同节题目</a>
          </div>
        </div>
        <div class="side-card">
          <h4>涉及的定理 <span>THEOREMS</span></h4>
          <div class="rel-list">
            ${relThms.length ? relThms.map(t => `<div class="rel-item"><span class="ri-id">${esc(t.label)}</span><a href="#/thm/${t.id}">${esc(t.title)}</a></div>`).join('') : '<div class="rel-item" style="color:var(--ink-3)">暂无关联</div>'}
          </div>
        </div>
      </aside>
    </div>
    <section class="detail-section">
      <h2>同节题目 <span>继续练习</span></h2>
      <div class="rel-detail-grid">${same.map(p => problemCard(p, {short:true})).join('')}</div>
    </section>
    ${footer()}
  </div>`;
  $('#bookmark-btn')?.addEventListener('click', () => toggleBookmark(id));
}

function toggleBookmark(id){
  if(bookmarks.has(id)){ bookmarks.delete(id); toast('已取消收藏'); }
  else { bookmarks.add(id); toast('已加入收藏'); }
  saveBookmarks();
  if(location.hash.startsWith('#/thm/') || location.hash.startsWith('#/problem/')) render();
  else renderSidebar();
}

/* ---------------- bookmarks ---------------- */
function renderBookmarks(){
  const list = Array.from(bookmarks).map(id => BY_ID.get(id)).filter(Boolean);
  app.innerHTML = `
  <div class="breadcrumb"><a href="#/">概览</a><span>/</span><span>我的收藏</span></div>
  <div class="sec-head"><h2>我的收藏 <span class="count">${list.length} 条</span></h2></div>
  ${list.length ? `<div class="grid">${list.map(it => it.type === 'theorem' ? theoremCard(it) : problemCard(it)).join('')}</div>` : `<div class="empty"><b>还没有收藏</b>在定理或题目详情页点击“收藏”，这里会集中显示。</div>`}
  ${footer()}`;
}

/* ---------------- graph ---------------- */
function renderGraph(q){
  const chapter = q.get('chapter') || '全部';
  const focus = q.get('focus') || '';
  app.innerHTML = `
  <div class="breadcrumb"><a href="#/">概览</a><span>/</span><span>知识图谱</span></div>
  <div class="sec-head"><h2>定理—题目图谱 <span class="count">${DATA.meta.stats.edges} 条关联 · 拖拽 / 滚轮 / 点击</span></h2></div>
  <div class="graph-shell">
    <div class="graph-toolbar">
      <span class="tb-label">范围</span>
      <a class="chip ${chapter==='全部'?'active':''}" href="#/graph">全部</a>
      ${CHAPTERS.map(c => `<a class="chip ${chapter===c.num?'active':''}" href="#/graph?chapter=${c.num}">第 ${c.num} 章</a>`).join('')}
      ${focus ? `<a class="chip" href="#/graph">取消聚焦 ×</a>` : ''}
      <div class="legend">
        <span><i style="background:#9b2f24"></i>定理</span>
        <span><i style="background:#2d5f7e"></i>定义</span>
        <span><i style="background:#2d6b68"></i>推论</span>
        <span><i style="background:#9a6a12"></i>引理</span>
        <span><i style="background:#5d6b78"></i>习题</span>
        <span><i style="background:#2f6b4f"></i>例题</span>
      </div>
    </div>
    <canvas id="graph-canvas"></canvas>
    <div class="graph-tip" id="graph-tip"></div>
    <div class="graph-hint">滚轮缩放 · 拖拽空白平移 · 拖拽节点微调 · 点击节点查看详情</div>
  </div>
  ${footer()}`;
  initGraph(chapter, focus);
}

function initGraph(chapterFilter, focusId){
  const canvas = $('#graph-canvas');
  const wrap = canvas.parentElement;
  const tip = $('#graph-tip');
  if(!canvas) return;
  cancelAnimationFrame(graphRAF);
  const ctx = canvas.getContext('2d');
  let W = 800, H = 600, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let scale = 1, ox = 0, oy = 0;
  let hover = null, dragNode = null, dragStart = null, dragging = false, panning = false;
  let alpha = 1, fitted = false, userMoved = false;

  const thms = FORMAL.filter(t => chapterFilter === '全部' || t.chapter === chapterFilter);
  const probs = PROBS.filter(p => chapterFilter === '全部' || p.chapter === chapterFilter);
  const thmSet = new Set(thms.map(t => t.id));
  const visible = new Set([...thms.map(t => t.id), ...probs.map(p => p.id)]);
  const nodes = [];
  const nodeById = new Map();
  const chapterCenters = {'1':[-0.42,-0.12], '2':[0.18,-0.46], '3':[0.5,0.26]};
  thms.forEach((t, i) => {
    const c = chapterCenters[t.chapter] || [0,0];
    const n = {id:t.id, item:t, type:'thm', r: 6.2 + Math.min(9, Math.sqrt((t.relatedProblems||[]).length) * 1.35),
      x: (c[0] + (Math.random()-0.5)*0.2) * 1000, y: (c[1] + (Math.random()-0.5)*0.2) * 800, vx:0, vy:0};
    nodes.push(n); nodeById.set(n.id, n);
  });
  probs.forEach((p, i) => {
    const rels = (p.relatedTheorems || []).map(r => nodeById.get(r.id)).filter(Boolean);
    const base = rels.length ? rels[0] : nodeById.get(thms[i % Math.max(1,thms.length)]?.id);
    const n = {id:p.id, item:p, type:'prob', r:3.2,
      x: (base ? base.x : 0) + (Math.random()-0.5)*180,
      y: (base ? base.y : 0) + (Math.random()-0.5)*180, vx:0, vy:0};
    nodes.push(n); nodeById.set(n.id, n);
  });
  const links = [];
  probs.forEach(p => {
    (p.relatedTheorems || []).forEach(r => {
      if(visible.has(r.id) && thmSet.has(r.id)) links.push({a:nodeById.get(p.id), b:nodeById.get(r.id)});
    });
  });
  const focusNode = focusId ? nodeById.get(focusId) : null;

  function resize(){
    const rect = wrap.getBoundingClientRect();
    W = Math.max(400, rect.width); H = Math.max(400, canvas.clientHeight || rect.height - 54);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if(focusNode){ ox = W/2 - focusNode.x*scale; oy = H/2 - focusNode.y*scale; }
  }
  let ro = new ResizeObserver(resize); ro.observe(wrap);
  resize();

  function tick(){
    alpha *= 0.988;
    const n = nodes.length;
    const cx = W/2, cy = H/2;
    // repulsion
    for(let i=0;i<n;i++){
      const a = nodes[i];
      for(let j=i+1;j<n;j++){
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx*dx + dy*dy;
        if(d2 < 1) { dx = Math.random()-0.5; dy = Math.random()-0.5; d2 = 1; }
        if(d2 > 90000) continue;
        const d = Math.sqrt(d2);
        const f = (a.type==='thm'&&b.type==='thm' ? 900 : 380) / d2;
        const fx = dx/d*f, fy = dy/d*f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    // springs
    for(const l of links){
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 1;
      const target = 90;
      const f = (d - target) * 0.0022;
      const fx = dx/d*f, fy = dy/d*f;
      l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
    }
    // center gravity + friction
    for(const nd of nodes){
      const dcx = (W/2 - ox)/scale - nd.x * 0 + 0;
      nd.vx += (0 - nd.x) * 0.00035;
      nd.vy += (0 - nd.y) * 0.00035;
      nd.vx *= 0.86; nd.vy *= 0.86;
      nd.x += nd.vx; nd.y += nd.vy;
    }
  }
  function draw(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(DPR*scale,0,0,DPR*scale, DPR*ox, DPR*oy);
    // edges
    ctx.lineWidth = 0.6/scale;
    for(const l of links){
      const active = hover && (l.a === hover || l.b === hover);
      ctx.strokeStyle = active ? 'rgba(155,47,36,.55)' : 'rgba(120,110,95,.15)';
      ctx.beginPath(); ctx.moveTo(l.a.x,l.a.y); ctx.lineTo(l.b.x,l.b.y); ctx.stroke();
    }
    // nodes
    for(const nd of nodes){
      const isHover = hover === nd;
      const isFocus = focusNode === nd;
      let color = nd.type === 'prob' ? (nd.item.kind === '例' ? '#2f6b4f' : '#5d6b78')
        : (nd.item.kind === '定理' ? '#9b2f24' : nd.item.kind === '定义' ? '#2d5f7e' : nd.item.kind === '推论' ? '#2d6b68' : '#9a6a12');
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, nd.r * (isHover?1.45:1) * (isFocus?1.5:1), 0, Math.PI*2);
      ctx.fillStyle = color; ctx.globalAlpha = nd.type==='prob' ? 0.78 : 0.95; ctx.fill(); ctx.globalAlpha = 1;
      if(isHover || isFocus){
        ctx.lineWidth = 2/scale; ctx.strokeStyle = '#c49a2c'; ctx.stroke();
      }
    }
    // chapter anchors
    if(scale < 0.8){
      for(const cnum of ['1','2','3']){
        const arr = nodes.filter(x => x.type==='thm' && x.item.chapter===cnum);
        if(!arr.length) continue;
        const ax = arr.reduce((a,x)=>a+x.x,0)/arr.length, ay = arr.reduce((a,x)=>a+x.y,0)/arr.length;
        ctx.font = `${18/scale}px "Noto Serif SC",SimSun,serif`;
        ctx.fillStyle = 'rgba(155,47,36,.30)';
        ctx.fillText('第 '+cnum+' 章', ax - 34/scale, ay - 62/scale);
      }
    }
    // labels
    const inkCol = (getComputedStyle(document.documentElement).getPropertyValue('--ink') || '#1c2a33').trim();
    ctx.font = `${11/scale}px "Segoe UI","Microsoft YaHei",sans-serif`;
    for(const nd of nodes){
      if(nd.type !== 'thm') continue;
      if(scale > 1.15 || (nd.item.relatedProblems || []).length >= 8 || hover === nd || focusNode === nd){
        ctx.fillStyle = inkCol; ctx.globalAlpha = .8;
        ctx.fillText(nd.item.label, nd.x + nd.r + 3/scale, nd.y + 4/scale); ctx.globalAlpha = 1;
      }
    }
    if(!fitted && alpha < 0.16 && !userMoved){
      if(focusNode){ scale=1.25; ox=W/2-focusNode.x*scale; oy=H/2-focusNode.y*scale; }
      else fitView();
      fitted=true;
    }
    if(alpha < 0.02 && !dragging && !panning) return;
    graphRAF = requestAnimationFrame(loop);
  }
  function loop(){ tick(); draw(); }
  function fitView(animate){
    if(!nodes.length) return;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const nd of nodes){ x0=Math.min(x0,nd.x); y0=Math.min(y0,nd.y); x1=Math.max(x1,nd.x); y1=Math.max(y1,nd.y); }
    const bw=Math.max(60,x1-x0), bh=Math.max(60,y1-y0);
    const target=Math.min((W-80)/bw,(H-80)/bh,1.5);
    scale=Math.max(0.3,target);
    ox=W/2-((x0+x1)/2)*scale; oy=H/2-((y0+y1)/2)*scale;
  }
  function screenToWorld(sx, sy){ return {x:(sx - ox)/scale, y:(sy - oy)/scale}; }
  function hit(sx, sy){
    const p = screenToWorld(sx, sy);
    let best = null, bestD = 1e9;
    for(const nd of nodes){
      const d = Math.hypot(nd.x - p.x, nd.y - p.y);
      if(d < nd.r + 5/scale && d < bestD){ best = nd; bestD = d; }
    }
    return best;
  }
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const n = hit(e.clientX - r.left, e.clientY - r.top);
    dragStart = {x:e.clientX, y:e.clientY, ox, oy};
    userMoved = true;
    if(n){ dragNode = n; canvas.setPointerCapture(e.pointerId); }
    else { panning = true; canvas.setPointerCapture(e.pointerId); }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if(dragNode){
      const p = screenToWorld(sx, sy);
      dragNode.x = p.x; dragNode.y = p.y; dragNode.vx = dragNode.vy = 0;
      alpha = Math.max(alpha, 0.3);
    } else if(panning && dragStart){
      ox = dragStart.ox + (e.clientX - dragStart.x);
      oy = dragStart.oy + (e.clientY - dragStart.y);
    } else {
      const n = hit(sx, sy);
      if(n !== hover){
        hover = n;
        if(n){
          tip.textContent = n.type === 'thm' ? `${n.item.label} ${n.item.title}` : `${n.item.label}`;
          tip.style.left = (sx) + 'px'; tip.style.top = (sy) + 'px'; tip.style.opacity = '1';
        } else tip.style.opacity = '0';
        alpha = Math.max(alpha, 0.2);
      } else if(n){
        tip.style.left = sx + 'px'; tip.style.top = sy + 'px';
      }
    }
  });
  canvas.addEventListener('pointerup', e => {
    if(dragNode && dragStart){
      const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
      if(moved < 5) go(itemHref(dragNode.item));
    } else if(panning && dragStart){
      const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
      if(moved < 4) { /* click empty */ }
    }
    dragNode = null; panning = false; canvas.style.cursor = 'grab';
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const before = screenToWorld(sx, sy);
    userMoved = true;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    scale = Math.min(3.2, Math.max(0.28, scale * factor));
    ox = sx - before.x * scale; oy = sy - before.y * scale;
    alpha = Math.max(alpha, 0.15);
  }, {passive:false});
  for(let i=0;i<110;i++) tick();
  if(focusNode){ scale=1.25; ox=W/2-focusNode.x*scale; oy=H/2-focusNode.y*scale; }
  else fitView();
  fitted = true; alpha = 0.35;
  graphRAF = requestAnimationFrame(loop);
  window.addEventListener('hashchange', () => { cancelAnimationFrame(graphRAF); ro.disconnect(); }, {once:true});
}

/* ---------------- not found ---------------- */
function renderNotFound(){
  app.innerHTML = `<div class="empty"><b>页面不存在</b>可能链接有误。<a href="#/" style="color:var(--accent)">返回概览</a></div>`;
}

/* ---------------- router ---------------- */
function render(){
  const r = route();
  const path = location.hash;
  if(path !== currentRoute){
    window.scrollTo({top:0, behavior:'instant'});
    currentRoute = path;
  }
  document.body.classList.remove('nav-open');
  $('#mobile-scrim').hidden = true;
  const [view, arg] = r.parts;
  if(!view) renderHome();
  else if(view === 'section') renderSection(arg, r.q);
  else if(view === 'chapter') renderChapter(arg);
  else if(view === 'theorems') renderTheorems(r.q);
  else if(view === 'problems') renderProblems(r.q);
  else if(view === 'thm') renderTheoremDetail(arg);
  else if(view === 'problem') renderProblemDetail(arg);
  else if(view === 'graph') renderGraph(r.q);
  else if(view === 'bookmarks') renderBookmarks();
  else renderNotFound();
  renderSidebar();
  // sync header search boxes from query
  if(view === 'theorems') $('#search-theorem').value = r.q.get('q') || '';
  else $('#search-theorem').value = '';
  if(view === 'problems') $('#search-problem').value = r.q.get('q') || '';
  else $('#search-problem').value = '';
  $('#search-pop').hidden = true;
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  $$('.topnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
}

/* ---------------- global search UI ---------------- */
function setupSearch(input, type){
  const pop = $('#search-pop');
  let activeIndex = -1;
  let results = [];
  const list = type === 'theorem' ? FORMAL : PROBS;
  const kindLabel = type === 'theorem' ? '定理' : '题目';
  function hide(){ pop.hidden = true; activeIndex = -1; }
  function renderPop(q){
    if(!q){ hide(); return; }
    results = searchItems(list, q, 7);
    if(!results.length){
      pop.innerHTML = `<div class="sp-empty">没有找到与“${esc(q)}”相关的${kindLabel}。<br>试试“夹逼”“单调有界”“Taylor”或题号。</div>`;
      pop.hidden = false; return;
    }
    pop.innerHTML = `<div class="sp-head"><span>${kindLabel}搜索 · <b>${results.length}</b> 条结果</span><span>Enter 查看全部 · Esc 关闭</span></div>` +
      results.map((it, i) => `<a class="sp-item ${i===activeIndex?'active':''}" href="${itemHref(it)}" data-i="${i}">
        <span class="sp-kind" style="background:${it.type==='theorem' ? (it.kind==='定理'?'#9b2f24':it.kind==='定义'?'#2d5f7e':it.kind==='推论'?'#2d6b68':'#9a6a12') : (it.kind==='例'?'#2f6b4f':'#5d6b78')}">${it.kind}</span>
        <span class="sp-main"><span class="sp-title">${hi(it.type==='theorem' ? (it.title || it.label) : problemTitle(it), q)}</span>
        <span class="sp-sub">${esc(it.label)} · ${esc(searchSub(it, q))}</span></span>
      </a>`).join('');
    pop.hidden = false;
  }
  input.addEventListener('input', () => { activeIndex = -1; renderPop(input.value.trim()); });
  input.addEventListener('focus', () => { if(input.value.trim()) renderPop(input.value.trim()); });
  input.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ hide(); input.blur(); return; }
    if(!results.length) return;
    if(e.key === 'ArrowDown'){ e.preventDefault(); activeIndex = (activeIndex + 1) % results.length; renderPop(input.value.trim()); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); activeIndex = (activeIndex - 1 + results.length) % results.length; renderPop(input.value.trim()); }
    else if(e.key === 'Enter'){
      e.preventDefault();
      if(activeIndex >= 0 && results[activeIndex]) go(itemHref(results[activeIndex]).slice(1));
      else {
        const q = input.value.trim();
        go(`#/${type === 'theorem' ? 'theorems' : 'problems'}?q=${encodeURIComponent(q)}`);
        hide();
      }
    }
  });
  input.addEventListener('blur', () => setTimeout(hide, 160));
  pop.addEventListener('mousedown', e => { e.preventDefault(); });
}
document.addEventListener('keydown', e => {
  const tag = (document.activeElement || {}).tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if(e.key === '/'){ e.preventDefault(); $('#search-theorem').focus(); }
  if(e.key === 'p' || e.key === 'P'){ e.preventDefault(); $('#search-problem').focus(); }
});

/* ---------------- interactions ---------------- */
app.addEventListener('click', e => {
  const t = e.target.closest('[data-item-id]');
  if(t && !e.target.closest('a,button')){
    const it = BY_ID.get(t.dataset.itemId);
    if(it) go(itemHref(it).slice(1));
  }
});
app.addEventListener('click', e => {
  const zoom = e.target.closest('[data-zoom]');
  if(zoom) openLightbox(zoom.dataset.zoom);
});
document.addEventListener('click', e => {
  if(!e.target.closest('.search-duo')) $('#search-pop').hidden = true;
});

/* ---------------- lightbox ---------------- */
let lbScale = 1, lbTx = 0, lbTy = 0, lbSrc = '';
const lbPointers = new Map();
let lbPinchStart = 0, lbPinchScale = 1, lbPanStart = null, lbMoved = false;

function applyLbTransform(){
  $('#lb-img').style.transform = `translate(${lbTx}px, ${lbTy}px) scale(${lbScale})`;
  $('#lb-zoom-label').textContent = Math.round(lbScale * 100) + '%';
}
function openLightbox(src){
  lbSrc = src; lbScale = 1; lbTx = 0; lbTy = 0;
  const lb = $('#lightbox'); lb.hidden = false;
  $('#lb-img').src = src;
  applyLbTransform();
  lbPointers.clear(); lbPinchStart = 0; lbPanStart = null;
  document.body.style.overflow = 'hidden';
}
function closeLightbox(){
  $('#lightbox').hidden = true; document.body.style.overflow = '';
  lbPointers.clear(); lbPinchStart = 0; lbPanStart = null;
}
function setLbScale(s){
  lbScale = Math.min(5, Math.max(0.3, s));
  if(lbScale <= 1){ lbTx = 0; lbTy = 0; }
  applyLbTransform();
}
$('#lb-close').addEventListener('click', closeLightbox);
$('#lb-zoom-in').addEventListener('click', () => setLbScale(lbScale * 1.2));
$('#lb-zoom-out').addEventListener('click', () => setLbScale(lbScale / 1.2));
$('#lb-reset').addEventListener('click', () => setLbScale(1));
$('#lightbox').addEventListener('click', e => {
  if(lbMoved){ lbMoved = false; return; }
  if(e.target.id === 'lightbox' || e.target.id === 'lb-stage') closeLightbox();
});
$('#lb-img').addEventListener('wheel', e => { e.preventDefault(); setLbScale(lbScale * (e.deltaY < 0 ? 1.1 : 0.9)); }, {passive:false});
$('#lb-img').addEventListener('dblclick', () => setLbScale(lbScale > 1.6 ? 1 : 2.2));
$('#lb-stage').addEventListener('pointerdown', e => {
  if(e.target.closest('button')) return;
  lbMoved = false;
  $('#lb-stage').setPointerCapture(e.pointerId);
  lbPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(lbPointers.size === 1){
    lbPanStart = {x:e.clientX, y:e.clientY, tx:lbTx, ty:lbTy};
  } else if(lbPointers.size === 2){
    const pts = Array.from(lbPointers.values());
    lbPinchStart = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
    lbPinchScale = lbScale;
    lbPanStart = null;
  }
});
$('#lb-stage').addEventListener('pointermove', e => {
  if(!lbPointers.has(e.pointerId)) return;
  const prev = lbPointers.get(e.pointerId);
  if(Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 3) lbMoved = true;
  lbPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(lbPointers.size >= 2 && lbPinchStart){
    const pts = Array.from(lbPointers.values()).slice(0,2);
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
    lbScale = Math.min(5, Math.max(0.3, lbPinchScale * dist / lbPinchStart));
    applyLbTransform();
  } else if(lbPointers.size === 1 && lbPanStart && lbScale > 1){
    lbTx = lbPanStart.tx + (e.clientX - lbPanStart.x);
    lbTy = lbPanStart.ty + (e.clientY - lbPanStart.y);
    applyLbTransform();
  }
});
function lbPointerEnd(e){
  lbPointers.delete(e.pointerId);
  if(lbPointers.size < 2) lbPinchStart = 0;
  if(lbPointers.size === 1){
    const p = Array.from(lbPointers.values())[0];
    lbPanStart = {x:p.x, y:p.y, tx:lbTx, ty:lbTy};
  } else lbPanStart = null;
}
$('#lb-stage').addEventListener('pointerup', lbPointerEnd);
$('#lb-stage').addEventListener('pointercancel', lbPointerEnd);
document.addEventListener('keydown', e => {
  if($('#lightbox').hidden) return;
  if(e.key === 'Escape') closeLightbox();
  if(e.key === '+' || e.key === '=') setLbScale(lbScale * 1.15);
  if(e.key === '-') setLbScale(lbScale / 1.15);
});

/* ---------------- theme / menu ---------------- */
const savedTheme = LS.get('ma-theme', null);
if(savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  LS.set('ma-theme', next);
  if(route().parts[0] === 'graph') render();
});
$('#menu-toggle').addEventListener('click', () => {
  document.body.classList.toggle('nav-open');
  $('#mobile-scrim').hidden = !document.body.classList.contains('nav-open');
});
$('#mobile-scrim').addEventListener('click', () => {
  document.body.classList.remove('nav-open'); $('#mobile-scrim').hidden = true;
});
$('#drawer-close').addEventListener('click', () => {
  document.body.classList.remove('nav-open'); $('#mobile-scrim').hidden = true;
});
document.addEventListener('keydown', e => { if(e.key === 'Escape'){ document.body.classList.remove('nav-open'); $('#mobile-scrim').hidden = true; } });

/* ---------------- boot ---------------- */
if('serviceWorker' in navigator && location.protocol === 'https:'){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
setupSearch($('#search-theorem'), 'theorem');
setupSearch($('#search-problem'), 'problem');
window.addEventListener('hashchange', render);
if(!location.hash) location.hash = '#/';
render();
})();
