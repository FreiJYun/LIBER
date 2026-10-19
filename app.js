/* LIBER — local-first personal blog. Data stays in this browser (IndexedDB). */
(() => {
'use strict';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const app = $('#app');
const Cats = window.LIBERCategories;
const Inline = window.LIBERInlinePhotos;
const Cloud = window.LIBERCloud;
const DB_NAME = 'liber_personal_blog_v1';
const SETTINGS_KEY = 'liber_blog_preferences_v1';
const SEED_KEY = 'liber_blog_seeded_v1';
const defaults = {
  title: 'LIBER', tagline: '오래 남겨 두고 싶은 생각과 순간들.',
  heroTitle: '생각이 머무는 곳,\n기록이 시작되는 곳.',
  heroDescription: '철학부터 일상의 작은 발견까지. 나의 시선으로 세상을 기록하는 개인적인 공간입니다.',
  about: '반갑습니다. 이곳은 특별한 주제 하나에 얽매이지 않고, 철학과 역사, 독서와 기술, 그리고 일상의 다양한 이야기를 남기는 개인 기록관입니다.\n\n천천히 둘러보시고, 마음에 남는 이야기를 만나시길 바랍니다.',
  theme: 'classic', font: 'noto', fontSize: 17
};
let config = loadConfig();
let db, currentRoute = '', activeCategory = '전체', searchQuery = '';
let editorFiles = [], editorId = null, inlineController = null;
let mediaURLs = [], customFontURL = null, leaveTimer = null, toastTimer = null;
let pageSwitchId = 0;
function escapeHTML(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeBreaks(s) { return escapeHTML(s).replace(/\n/g, '<br>'); }
function txt(html) { const e = document.createElement('div'); e.innerHTML = html || ''; return e.textContent || ''; }
function crop(v, n = 120) { const s = String(v || '').trim(); return s.length > n ? s.slice(0, n).trimEnd() + '…' : s; }
function dateText(ms) { try { return new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'long',day:'numeric'}).format(new Date(ms)); } catch { return '날짜 없음'; } }
function readTime(post) { return Math.max(1, Math.ceil(txt(post.body).length / 500)); }
function uid() { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `post-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function loadConfig() { try { return {...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')}; } catch { return {...defaults}; } }
function writeConfig() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(config)); applyConfig(); }
function toast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('shown'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('shown'), 3500); }
function getDB() { return new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    const database = req.result;
    if (!database.objectStoreNames.contains('posts')) database.createObjectStore('posts', {keyPath:'id'});
    if (!database.objectStoreNames.contains('assets')) database.createObjectStore('assets', {keyPath:'id'});
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('브라우저 저장소를 열 수 없습니다.'));
}); }
function store(name, mode, cb) { return new Promise((resolve, reject) => {
  const tx = db.transaction(name, mode); let result;
  try { result = cb(tx.objectStore(name)); } catch(e) { reject(e); return; }
  if (result && typeof result === 'object' && 'onsuccess' in result) result.onsuccess = () => { result = result.result; };
  tx.oncomplete = () => resolve(result);
  tx.onerror = () => reject(tx.error || new Error('저장 중 오류가 발생했습니다.'));
  tx.onabort = () => reject(tx.error || new Error('저장 작업이 중단되었습니다.'));
}); }
async function localAllPosts(includeDrafts = true) {
  const rows = await store('posts','readonly', s => s.getAll());
  return rows.filter(p => includeDrafts || p.published !== false).sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
}
function localGetPost(id) { return store('posts','readonly', s => s.get(id)); }
function localPutPost(post) { return store('posts','readwrite',s => s.put(post)); }
function allPosts(includeDrafts = true) { return Cloud.posts(includeDrafts); }
function getPost(id) { return Cloud.post(id); }
function putPost(post) { return Cloud.savePost(post); }
function removePost(id) { return Cloud.deletePost(id); }
function assetGet(id) { return store('assets','readonly',s => s.get(id)); }
function assetPut(asset) { return store('assets','readwrite',s => s.put(asset)); }
function objectURL(blob) {
 if(typeof blob==='string')return blob;
 const u=URL.createObjectURL(blob);mediaURLs.push(u);return u;
}
function mediaSrc(file){return file?.remoteUrl || (file?.storagePath ? Cloud.urlFor(file.storagePath) : '') || (file?.blob ? objectURL(file.blob) : '');}
function clearMediaURLs() { for (const u of mediaURLs) URL.revokeObjectURL(u); mediaURLs = []; }
function sanitizeHTML(input) {
  const parse = document.createElement('template'); parse.innerHTML = input || '';
  const allowed = new Set(['P','DIV','SPAN','BR','B','STRONG','I','EM','U','H2','H3','H4','UL','OL','LI','BLOCKQUOTE','A','HR','S','STRIKE']);
  const blocked = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','INPUT','BUTTON','VIDEO','IMG','LINK','META','TEMPLATE']);
  const clean = (node) => {
    if(node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
    if(node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const tag = node.tagName;
    if(tag === 'SPAN' && node.hasAttribute('data-photo-id')) return Inline.cleanMarker(node);
  if(blocked.has(tag)) return document.createDocumentFragment();
    const out = allowed.has(tag) ? document.createElement(tag.toLowerCase()) : document.createDocumentFragment();
    if(tag === 'A' && out.nodeType === Node.ELEMENT_NODE) {
      const href = node.getAttribute('href') || '';
      if (/^(https?:\/\/|mailto:)/i.test(href)) { out.setAttribute('href', href); out.setAttribute('target','_blank'); out.setAttribute('rel','noopener noreferrer'); }
    }
    for(const ch of Array.from(node.childNodes)) out.appendChild(clean(ch));
    return out;
  };
  const wrap = document.createElement('div');
  Array.from(parse.content.childNodes).forEach(ch => wrap.appendChild(clean(ch)));
  return wrap.innerHTML;
}
function seedPosts() {
  return [
    {id:'example-1', demo:true, published:true, title:'여기에 나의 이야기를 남깁니다', category:'일상', subtitle:'처음 방문하신 분들을 위한 작은 인사', createdAt:Date.now()-3600*1000*2,
      body:'<p>반갑습니다. 이곳은 개인 홈페이지이자 블로그, 그리고 생각의 기록관입니다.</p><p>철학과 역사, 독서, 기술, 여행, 하루의 소소한 이야기까지. 주제를 미리 제한하지 않고 그날의 생각을 자유롭게 담아 보려 합니다.</p><h2>이 블로그에서 할 수 있는 일</h2><p>상단의 <strong>글쓰기</strong>를 눌러 새 포스팅을 작성해 보세요. 사진과 동영상을 첨부할 수도 있고, 설정에서 서체와 테마를 자유롭게 바꿀 수도 있습니다.</p><blockquote>기록은 지나간 생각을 다시 만나는 방법입니다.</blockquote><p>이 글은 예시 게시글이므로 언제든지 삭제하셔도 됩니다.</p>', attachments:[], links:[]},
    {id:'example-2', demo:true, published:true, title:'역사를 읽는다는 것의 의미', category:'역사', subtitle:'오래된 이야기에서 새로운 질문을 찾다', createdAt:Date.now()-3600*1000*30,
      body:'<p>역사를 읽는다는 것은 단지 과거에 있었던 일을 외우는 것이 아닙니다. 오래된 결정과 선택이 오늘의 우리에게 어떤 질문을 남기는지 생각하는 일입니다.</p><p>가령 로마 공화정의 기록을 읽을 때에도, 사건의 나열 너머에 있는 사람들의 이상과 갈등을 살펴볼 수 있습니다.</p><p>이 글은 블로그의 디자인을 시험하기 위해 넣어 둔 <strong>예시 게시글</strong>입니다.</p>',attachments:[],links:[]},
    {id:'example-3', demo:true, published:true, title:'좋은 삶에 관한 작은 메모', category:'철학', subtitle:'일상 속에서 철학적 질문을 발견하기', createdAt:Date.now()-3600*1000*60,
      body:'<p>어떤 삶이 좋은 삶일까요? 정답을 서둘러 선언하는 대신, 먼저 질문을 오래 붙들어 보는 것도 의미 있는 일일 것입니다.</p><p>책의 한 문장이나 일상 속 사건이 새로운 생각의 출발점이 되기도 합니다.</p><p>이 글은 예시 글입니다. 자유롭게 수정하거나 삭제해 보세요.</p>',attachments:[],links:[]}
  ];
}
async function ensureSeed() {
 // Visitors never receive separate browser-only seed posts.
 return;
}
async function applyConfig() {
  document.body.dataset.theme = ['classic','night','modern'].includes(config.theme) ? config.theme : 'classic';
  document.body.dataset.font = ['noto','serif','system','custom'].includes(config.font) ? config.font : 'noto';
  document.documentElement.style.setProperty('--read-size', `${Math.min(24,Math.max(14,Number(config.fontSize)||17))}px`);
  $('#headerBrand').textContent = config.title || defaults.title;
  $('#footerBrand').textContent = config.title || defaults.title;
  $('#copyrightBrand').textContent = config.title || defaults.title;
  $('#footerTagline').textContent = config.tagline || defaults.tagline;
  document.title = `${config.title || defaults.title} — 나의 기록관`;
  const metaTheme = $('meta[name="theme-color"]'); if(metaTheme) metaTheme.content = config.theme==='night'?'#191b21':config.theme==='modern'?'#eff2f1':'#f7f3eb';
  if (config.font==='custom' && db) {
    const rec = await assetGet('customFont');
    if(rec && rec.blob) {
      if(customFontURL) URL.revokeObjectURL(customFontURL);
      customFontURL = URL.createObjectURL(rec.blob);
      let st = $('#user-font-style');
      if(!st) { st = document.createElement('style'); st.id='user-font-style'; document.head.appendChild(st); }
      st.textContent = `@font-face {font-family:"CustomBlogFont";src:url("${customFontURL}");font-display:swap;}`;
    } else document.body.dataset.font = 'noto';
  }
}
function categoryClass(cat) {
  if(cat==='철학') return 'philosophy'; if(cat==='역사') return 'history'; if(cat==='일상') return 'life'; if(cat==='독서') return 'reading'; return 'general';
}
function categoryGlyph(cat) {
  if(cat==='철학') return 'Φ'; if(cat==='역사') return 'Ⅹ'; if(cat==='독서') return 'ℒ'; if(cat==='일상') return '✳'; if(cat==='기술') return '⌘'; return '✦';
}
function thumb(post) {
  const cover = (post.attachments||[]).find(f => (f.type||'').startsWith('image/'));
  if(cover && (cover.blob||cover.remoteUrl)) return `<div class="post-image"><img loading="lazy" src="${escapeHTML(mediaSrc(cover))}" alt="${escapeHTML(post.title)}의 첨부 이미지" /></div>`;
  return `<div class="post-image pattern-${categoryClass(post.category)}"><span class="art-glyph" aria-hidden="true">${categoryGlyph(post.category)}</span></div>`;
}
function card(post) {
  return `<article class="post-card">${thumb(post)}<div class="post-body"><div class="post-card-top"><span>${escapeHTML(Cats.postName(post))}</span><time datetime="${new Date(post.createdAt).toISOString()}">${dateText(post.createdAt)}</time>${post.demo?'<span class="demo-tag">예시</span>':''}</div><h3><a href="#/post/${encodeURIComponent(post.id)}">${escapeHTML(post.title)}</a></h3><p>${escapeHTML(crop(post.subtitle||txt(post.body),103))}</p><div class="post-card-bottom"><span>약 ${readTime(post)}분 읽기</span><a href="#/post/${encodeURIComponent(post.id)}">자세히 읽기 →</a></div></div></article>`;
}
const temple = `<svg class="temple-svg" viewBox="0 0 650 570" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="templeStone" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4d7a8" stop-opacity=".63"/><stop offset="1" stop-color="#d8a873" stop-opacity=".3"/></linearGradient><pattern id="stoneLines" width="34" height="12" patternUnits="userSpaceOnUse"><path d="M0 11H34" stroke="#fff7dd" opacity=".13"/></pattern></defs><g fill="url(#templeStone)" stroke="#f4e0b8" stroke-opacity=".46" stroke-width="2"><path d="M52 207L325 70 599 207v23H52z"/><path d="M85 230h480v30H85z"/><path d="M93 267h464v20H93z"/><rect x="106" y="286" width="47" height="207"/><rect x="197" y="286" width="47" height="207"/><rect x="288" y="286" width="47" height="207"/><rect x="379" y="286" width="47" height="207"/><rect x="470" y="286" width="47" height="207"/><path d="M69 492h512v31H69z"/><path d="M42 524h566v23H42z"/><path d="M26 547h598v20H26z"/></g><g fill="none" stroke="#ffe5b7" opacity=".24"><path d="M115 300v182m15-182v182m76-182v182m15-182v182m76-182v182m15-182v182m76-182v182m15-182v182m76-182v182m15-182v182" stroke-width="3"/><path d="M164 194l160-81 161 81H164z"/><circle cx="325" cy="167" r="23"/></g><path d="M0 567H650" stroke="#fff7df" opacity=".35" stroke-width="5"/><rect x="26" y="211" width="598" height="356" fill="url(#stoneLines)" opacity=".2"/></svg>`;
function banner(eyebrow,title,desc) { return `<section class="page-banner"><div class="container"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${desc}</p></div></section>`; }
async function home() {
 const posts=(await allPosts(false)).slice(0,3), cats = new Set((await allPosts(false)).map(p=>p.category)).size;
 return `<section class="hero"><div class="hero-inner"><div class="hero-copy"><div class="hero-kicker">PERSONAL JOURNAL · MMXXVI</div><h1>${safeBreaks(config.heroTitle||defaults.heroTitle)}</h1><p>${escapeHTML(config.heroDescription||defaults.heroDescription)}</p><div class="hero-buttons"><a class="hero-btn" href="#/posts">글 둘러보기 ↗</a><a class="hero-btn hero-btn-ghost" href="#/about">이 공간에 대하여</a></div></div><div class="hero-art">${temple}</div><div class="hero-side-number">EST. MMXXVI</div><div class="hero-footnote">VERBA VOLANT, SCRIPTA MANENT</div></div></section>
 <section class="intro-strip"><div class="container intro-strip-inner"><div class="intro-stat"><strong>${(await allPosts(false)).length.toString().padStart(2,'0')}</strong><span>남겨진 이야기</span></div><div class="intro-stat"><strong>${cats.toString().padStart(2,'0')}</strong><span>다양한 주제</span></div><div class="intro-quote">“기록은 지나간 생각을 다시 만나는 일입니다.”<br><span class="minor-label">A SMALL NOTE TO REMEMBER</span></div></div></section>
 <section class="section-pad"><div class="container"><div class="section-head"><div><div class="eyebrow">RECENT JOURNAL</div><h2>최근의 기록</h2></div><a class="plain-link" href="#/posts">모든 글 보기 →</a></div>${posts.length?`<div class="post-grid">${posts.map(card).join('')}</div>`:emptyPosts()}</div></section>
 <section class="feature-section"><div class="container"><div class="feature-inner"><div class="feature-art"><span>LIBER</span></div><div class="feature-copy"><div class="eyebrow">ABOUT THE ARCHIVE</div><h2>하나의 주제에<br>머물지 않는 공간</h2><p>철학과 역사, 사소한 일상의 발견까지. 이곳에는 다양한 이야기들이 차곡차곡 쌓입니다.</p><a href="#/about" class="plain-link">블로그에 관하여 →</a></div></div></div></section>`;
}
function emptyPosts() { return `<div class="empty-state"><span class="empty-icon">✧</span><strong>아직 기록이 없습니다</strong><p>새로운 글을 작성해서 첫 이야기를 남겨 보세요.</p><a href="#/write" class="btn btn-sm">첫 글 쓰기</a></div>`; }
async function postsPage(){
 const rows = await allPosts(false);
 const q = searchQuery.trim().toLocaleLowerCase();
 const filtered = rows.filter(p=>Cats.postMatches(p,activeCategory)&&(!q||[p.title,p.subtitle,txt(p.body),Cats.postName(p),...(p.tags||[])].join(' ').toLocaleLowerCase().includes(q)));
 const heading = activeCategory === '전체' ? '모든 기록' : Cats.breadcrumb('posts',activeCategory)||'모든 기록';
 return `${banner('THE JOURNAL','기록의 서가','주제에 얽매이지 않는 생각과 이야기들을 모았습니다.')}
 <section class="content-section journal-section"><div class="container">
 <div class="journal-layout">
 ${window.LIBERJournalSidebar.render(rows,activeCategory)}
 <div class="journal-main">
 <div class="journal-results-head">
 <div><div class="eyebrow">COLLECTED STORIES</div><h2>${escapeHTML(heading)}</h2></div>
 <input type="search" class="search-input" id="postSearch" placeholder="제목 또는 내용 검색" aria-label="게시글 검색" value="${escapeHTML(searchQuery)}" />
 </div>
 <div class="post-result-label" aria-live="polite">검색 결과 <strong>${filtered.length}</strong>개의 글</div>
 <div id="postResults">${filtered.length?`<div class="post-grid">${filtered.map(card).join('')}</div>`:`<div class="empty-state"><span class="empty-icon">⌕</span><strong>일치하는 글이 없습니다</strong><p>다른 검색어나 카테고리를 선택해 주세요.</p></div>`}</div>
 </div></div></div></section>`;
}
function parseYouTube(url) { try { const u = new URL(url); let id = '';
 if (u.hostname==='youtu.be'||u.hostname==='www.youtu.be') id = u.pathname.split('/')[1]||'';
 else if(['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname)) {
 if(u.pathname==='/watch') id = u.searchParams.get('v')||'';
 else if(/^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2]||'';
 }
 return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
 } catch { return null; } }
function mediaSection(post, coverIncluded = false) {
 const original=post.attachments||[], links=post.links||[];
 // The first image has already been displayed as the article cover.
 const inlineIds=Inline.ids(post.body);
 const firstImageIndex = coverIncluded ? original.findIndex(a=>(a.type||'').startsWith('image/')&&(a.blob||a.remoteUrl)&&!inlineIds.has(String(a.id))) : -1;
 const attachments = original.filter((a,i)=>i!==firstImageIndex&&!inlineIds.has(String(a.id)));
 if(!attachments.length&&!links.length) return '';
 let items=attachments.map(a=>{
  if(!a.blob&&!a.remoteUrl)return '';
  const u=mediaSrc(a);
  if((a.type||'').startsWith('image/')) return `<figure class="media-tile"><img src="${u}" alt="${escapeHTML(a.name)}" loading="lazy"/><figcaption>${escapeHTML(a.name)}</figcaption></figure>`;
  if((a.type||'').startsWith('video/')) return `<figure class="media-tile"><video controls preload="metadata" src="${u}">이 브라우저는 동영상을 지원하지 않습니다.</video><figcaption>${escapeHTML(a.name)}</figcaption></figure>`;
  return '';
 }).join('');
 items += links.map(s=>{
  const id=parseYouTube(s);
  if(id) return `<figure class="media-tile"><iframe class="video-frame" loading="lazy" src="https://www.youtube-nocookie.com/embed/${id}" title="유튜브 동영상" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></figure>`;
  try { const u=new URL(s); if(u.protocol==='https:'||u.protocol==='http:') { if(/\.(mp4|webm|ogg)(\?|$)/i.test(u.pathname+u.search)) return `<figure class="media-tile"><video controls preload="metadata" src="${escapeHTML(u.href)}"></video></figure>`; return `<p>관련 링크: <a href="${escapeHTML(u.href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(u.href)}</a></p>`; } } catch {}
  return '';
 }).join('');
 return `<section class="article-media"><h3>첨부 미디어</h3>${items}</section>`;
}
async function articlePage(id) {
 const post = await getPost(id);
 if(!post) return `${banner('THE JOURNAL','글을 찾을 수 없습니다','주소가 변경되었거나 삭제된 글입니다.')}<div class="container content-section"><a class="btn" href="#/posts">글 목록으로</a></div>`;
 const inlineIds=Inline.ids(post.body);
 const cover=(post.attachments||[]).find(a=>(a.type||'').startsWith('image/')&&(a.blob||a.remoteUrl)&&!inlineIds.has(String(a.id)));
 return `<article class="article-shell"><nav class="crumb" aria-label="현재 위치"><a href="#/home">HOME</a> / <a href="#/posts">JOURNAL</a> / ${escapeHTML(Cats.postName(post))}</nav><header class="article-header"><div class="article-labels"><span>${escapeHTML(Cats.postName(post))}</span>${post.demo?'<span class="demo-tag">예시 글</span>':''}${post.published===false?'<span class="demo-tag">임시저장</span>':''}</div><h1>${escapeHTML(post.title)}</h1>${post.subtitle?`<p class="article-subtitle">${escapeHTML(post.subtitle)}</p>`:''}${post.tags?.length?`<div class="article-tags">${post.tags.map(t=>`<span>#${escapeHTML(t)}</span>`).join('')}</div>`:''}<div class="article-meta"><time datetime="${new Date(post.createdAt).toISOString()}">${dateText(post.createdAt)}</time><span>약 ${readTime(post)}분 읽기</span>${post.updatedAt?`<span>수정 ${dateText(post.updatedAt)}</span>`:''}</div></header>${cover?`<div class="article-cover"><img src="${escapeHTML(mediaSrc(cover))}" alt="${escapeHTML(post.title)}" /></div>`:''}<div class="article-body">${sanitizeHTML(post.body)}</div>${mediaSection(post,!!cover)}<div class="article-actions"><a href="#/posts" class="btn btn-outline btn-sm">← 모든 글 보기</a>${Cloud.isAdmin()? `<div class="btn-row"><a href="#/write/${encodeURIComponent(post.id)}" class="btn btn-quiet btn-sm">이 글 수정</a><button type="button" class="btn btn-danger btn-sm" data-delete="${escapeHTML(post.id)}">글 삭제</button></div>`:''}</div><div class="article-end">✦</div></article>`;
}
function adminRequiredPage(message) {
 return `${banner('ADMINISTRATION','관리자 전용','이 작업은 LIBER 관리자만 수행할 수 있습니다.')}<section class="content-section"><div class="container"><div class="panel"><h3>${escapeHTML(message)}</h3><p>관리자 인증을 마친 후 다시 시도해 주세요.</p><a href="#/admin" class="btn">관리자 로그인 →</a></div></div></section>`;
}
function categoryOptions(current) { return Cats.options('posts',Cats.postId(current || {category:'일상'})); }
async function editorPage(id) {
 if(!Cloud.isAdmin())return adminRequiredPage('글쓰기·편집은 관리자만 가능합니다.');
 editorId=id||null;
 const post=editorId?await getPost(editorId):null;
 if(editorId&&!post) return `${banner('EDITOR','게시글을 찾을 수 없습니다','새 게시글을 작성해 주세요.')}<div class="container content-section"><a class="btn" href="#/write">새 글쓰기</a></div>`;
 editorFiles=(post?.attachments||[]).map(a=>({...a}));
 const drafts=(await allPosts()).filter(p=>p.published===false);
 return `${banner('WRITE YOUR STORY',post?'글 수정하기':'새로운 기록','지금의 생각을 자유롭게 적어 보세요.')}<section class="content-section"><div class="container editor-grid"><div><div class="panel"><div class="field"><label for="editTitle">게시글 제목</label><input type="text" id="editTitle" maxlength="160" placeholder="어떤 이야기를 남기실 건가요?" value="${escapeHTML(post?.title||'')}" required /></div><div class="field"><label for="editSubtitle">짧은 소개 (선택)</label><input type="text" id="editSubtitle" maxlength="250" placeholder="게시글 목록에 표시될 한 문장" value="${escapeHTML(post?.subtitle||'')}" /></div><div class="field"><span class="field-title">본문</span><div class="editor-toolbar" role="toolbar" aria-label="서식 편집 도구"><button type="button" class="tool-btn" data-command="bold" title="굵게"><b>B</b></button><button type="button" class="tool-btn" data-command="italic" title="기울임"><i>I</i></button><button type="button" class="tool-btn" data-command="underline" title="밑줄"><u>U</u></button><span class="tool-sep"></span><button type="button" class="tool-btn" data-block="p" title="본문">본문</button><button type="button" class="tool-btn" data-block="h2" title="큰 제목">H2</button><button type="button" class="tool-btn" data-block="h3" title="작은 제목">H3</button><span class="tool-sep"></span><button type="button" class="tool-btn" data-command="insertUnorderedList" title="글머리 기호">☷</button><button type="button" class="tool-btn" data-command="insertOrderedList" title="번호 목록">①</button><button type="button" class="tool-btn" data-block="blockquote" title="인용문">❝</button><button type="button" class="tool-btn" data-command="createLink" title="링크 삽입">↗</button><button type="button" class="tool-btn" data-command="removeFormat" title="서식 제거">Tx</button><span class="tool-sep"></span><button type="button" class="tool-btn inline-image-trigger" id="insertInlinePhoto" title="커서 위치에 사진 삽입">▧ 사진 삽입</button><input type="file" id="inlinePhotoInput" accept="image/*" multiple hidden /></div><div class="rich-editor" id="richEditor" contenteditable="true" role="textbox" aria-label="게시글 본문" aria-multiline="true" data-placeholder="이야기를 시작하세요...">${sanitizeHTML(post?.body||'')}</div><div id="inlinePhotoControls" class="inline-photo-controls" hidden><div class="inline-photo-controls-heading"><strong>선택한 사진 편집</strong><span>드래그해서 본문 위치를 이동할 수도 있습니다.</span></div><div class="inline-photo-controls-grid"><label>사진 설명<input type="text" id="inlinePhotoCaption" maxlength="200" placeholder="사진 아래 표시할 설명" /></label><label>사진 크기<select id="inlinePhotoWidth"><option value="100">크게 (100%)</option><option value="75">중간 (75%)</option><option value="50">작게 (50%)</option></select></label><label>정렬<select id="inlinePhotoAlign"><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label></div><div class="inline-photo-controls-actions"><button type="button" id="inlinePhotoMoveUp" class="btn btn-sm btn-outline">↑ 앞 문단으로</button><button type="button" id="inlinePhotoMoveDown" class="btn btn-sm btn-outline">↓ 다음 문단으로</button><button type="button" id="inlinePhotoRemove" class="btn btn-sm btn-danger">사진 제거</button></div></div><p class="field-help">사진 삽입을 누르면 현재 커서 위치에 추가됩니다. 삽입한 사진을 클릭하면 크기·정렬·설명을 바꿀 수 있습니다.  한글은 어절 단위로 줄바꿈하도록 설정했습니다.</p></div></div><div class="editor-action-row"><a href="${post?`#/post/${encodeURIComponent(post.id)}`:'#/posts'}" class="btn btn-outline">← 돌아가기</a><div class="btn-row"><button id="saveDraft" type="button" class="btn btn-quiet">임시저장</button><button id="publishPost" type="button" class="btn">${post?.published===false||!post?'게시하기':'변경사항 저장'} →</button></div></div><p class="draft-msg" id="editorMessage">※ 글과 첨부 파일은 현재 브라우저에만 저장됩니다. 다른 기기에 자동으로 동기화되지 않습니다.</p></div><aside><div class="panel"><h3>글 설정</h3><div class="field"><label for="editCategory">카테고리</label><select id="editCategory">${categoryOptions(post)}</select><p class="field-help">선택한 카테고리의 하위 분류를 빠르게 추가하거나 <a href="#/categories">카테고리 관리</a>에서 트리를 편집하세요.</p><input type="text" id="newCategory" maxlength="40" placeholder="새 하위 카테고리 이름 (선택)" /></div><div class="field"><label for="editTags">태그 (쉼표로 구분, 최대 8개)</label><input type="text" id="editTags" maxlength="240" placeholder="예: 역사, 독서노트" value="${escapeHTML((post?.tags||[]).join(', '))}" /></div><div class="field"><span class="field-title">사진·동영상 첨부</span><div class="upload-zone"><strong>＋ 파일 선택</strong><p>사진 또는 동영상 여러 개 첨부 가능</p><input type="file" id="mediaUpload" accept="image/*,video/*" multiple aria-label="사진 또는 동영상 업로드" /></div><div class="upload-list" id="uploadList"></div><p class="field-help">본문에 삽입한 사진은 그 위치에 나타나며, 별도 첨부 사진·영상은 글 하단에 표시됩니다. 큰 파일은 브라우저 저장 공간에 제한이 있을 수 있습니다.</p></div><div class="field"><label for="editLinks">동영상·유튜브 링크</label><textarea id="editLinks" rows="4" placeholder="https://youtu.be/...\n링크를 한 줄에 하나씩 입력">${escapeHTML((post?.links||[]).join('\n'))}</textarea></div></div><div class="side-help">✦ <strong>로컬 블로그 안내</strong><br>이 버전에서는 작성하신 글이 방문자에게 공유되지 않습니다. 공개 운영 전에 로그인·DB 연동을 추가해야 합니다.</div>${drafts.length?`<div class="side-help"><strong>임시저장 글 (${drafts.length})</strong><br>${drafts.slice(0,5).map(d=>`<a href="#/write/${encodeURIComponent(d.id)}">↳ ${escapeHTML(crop(d.title||'제목 없음',24))}</a>`).join('<br>')}</div>`:''}</aside></div></section>`;
}
function aboutPage() { return `${banner('THE PERSON BEHIND THE PAGES','이 공간에 대하여','누구의 무엇을 위한 기록인지 소개합니다.')}<div class="container about-layout"><div><div class="eyebrow">NICE TO MEET YOU</div><h2>한 편의 글에서 시작되는<br>새로운 대화와 발견.</h2><span class="line-gold"></span><p>${escapeHTML(config.about||defaults.about)}</p><div class="btn-row"><a href="#/posts" class="btn">기록 둘러보기 →</a><a href="#/settings" class="btn btn-outline">소개글 수정</a></div></div><div class="about-decoration"><strong>✦</strong></div></div>`; }
function galleryPage() { return `${banner('THE GALLERY','사진첩','사진과 순간을 따로 모아 둘 공간입니다.')}<div class="container"><section class="gallery-await"><div class="symbol">❧</div><div class="eyebrow">COMING LATER</div><h2>사진첩은 준비 중입니다</h2><p>우선 블로그 글에 사진과 동영상을 첨부할 수 있습니다.<br>독립 사진첩은 나중에 확장할 수 있도록 메뉴를 마련했습니다.</p><a href="#/posts" class="btn btn-outline">블로그로 돌아가기 →</a></section></div>`; }
function themeChoice(id,name,desc,bg,side,text) { return `<button type="button" class="theme-option ${config.theme===id?'selected':''}" data-theme-choice="${id}" aria-pressed="${config.theme===id}"><span class="theme-swatch" style="background:${bg};color:${text}"><span class="swatch-side" style="background:${side}"></span><span class="swatch-main" style="background:${text}"></span></span><strong>${name}</strong><small>${desc}</small></button>`; }
function fontChoice(id,label) { return `<button type="button" class="choice-btn ${config.font===id?'selected':''}" data-font-choice="${id}" aria-pressed="${config.font===id}">${label}</button>`; }

function adminPage(){
 const signed=Cloud.currentUser();
 let content='';
 if(Cloud.isAdmin()){
  content='<h3>관리자 인증 완료</h3><p>글·카테고리·이웃을 Supabase에 저장할 수 있습니다.</p><div class="btn-row"><a href="#/write" class="btn">새 글 작성</a><a href="#/categories" class="btn btn-outline">카테고리 관리</a><a href="#/settings" class="btn btn-outline">블로그 설정</a></div>';
 }else if(signed){
  content='<h3>로그인 완료 · 관리자 승인 대기</h3><p>편집하려면 Supabase SQL Editor에서 다음 SQL을 한 번 실행해야 합니다.</p>'+
  '<pre class="cloud-bootstrap-sql">insert into public.liber_admins(user_id) values ('+"'"+escapeHTML(signed.id)+"'"+') on conflict do nothing;</pre>'+
  '<p>관리자 승인 명부는 웹 방문자가 직접 변경할 수 없습니다. <a target="_blank" rel="noopener noreferrer" href="https://supabase.com/dashboard/project/muwvbthekagigehnywjx/sql/new">Supabase SQL Editor ↗</a></p>'+
  '<button id="checkAdmin" class="btn" type="button">관리자 권한 다시 확인</button>';
 }else{
  content='<form id="cloudLoginForm" class="cloud-login-form"><label for="cloudLoginEmail">로그인 이메일</label><input type="email" id="cloudLoginEmail" required autocomplete="email" placeholder="example@email.com"><button type="submit" class="btn">이메일 로그인 링크 보내기</button><p>인증 링크로 로그인한 후 관리자 승인을 받으면 글쓰기가 가능합니다.</p></form>';
 }
 return banner('LIBER ADMIN','관리자 로그인','LIBER 편집 권한을 안전하게 보호합니다.')+
  '<section class="content-section"><div class="container cloud-admin-shell"><div class="panel">'+
  (signed?'<p class="cloud-login-identity">로그인 계정: '+escapeHTML(signed.email||'')+'</p>':'')+
  content+(signed?'<button type="button" id="cloudLogout" class="btn btn-outline btn-sm">로그아웃</button>':'')+
  '<p id="cloudAuthStatus" role="status" aria-live="polite"></p></div></div></section>';
}
function setupAdmin(){
 const status=$('#cloudAuthStatus');
 const notice=message=>{if(status)status.textContent=message;};
 $('#cloudLoginForm')?.addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
  try{await Cloud.sendLogin($('#cloudLoginEmail').value.trim());notice('로그인 링크를 전송했습니다. 이메일을 확인해 주세요.');}
  catch(error){notice('전송 실패: '+error.message);}
  finally{button.disabled=false;}
 });
 $('#cloudLogout')?.addEventListener('click',async()=>{
  try{await Cloud.signOut();location.reload();}catch(e){notice(e.message);}
 });
 $('#checkAdmin')?.addEventListener('click',async()=>{
  try{await Cloud.refreshAdmin();if(Cloud.isAdmin()){document.body.classList.add('is-liber-admin');await render();}else notice('아직 관리자 명부에 등록되지 않았습니다.');}
  catch(e){notice(e.message);}
 });
}

function settingsPage() { return `${banner('PERSONALIZE YOUR SPACE','블로그 설정','테마, 서체, 소개글을 원하는 대로 변경해 보세요.')}<section class="content-section"><div class="container settings-layout"><nav class="settings-nav" aria-label="설정 항목"><a href="#appearance" class="active" data-settings-anchor="appearance">테마 디자인</a><a href="#typography" data-settings-anchor="typography">서체·가독성</a><a href="#identity" data-settings-anchor="identity">홈페이지 소개</a><a href="#storage" data-settings-anchor="storage">백업·데이터</a><a href="#/admin" class="cloud-admin-link">관리자 인증 ↗</a></nav><div><section id="appearance" class="settings-panel"><div class="eyebrow">01 / APPEARANCE</div><h2>테마 디자인</h2><p>블로그의 전반적인 색상과 분위기를 선택할 수 있습니다. 변경 사항은 즉시 반영됩니다.</p><div class="theme-options">${themeChoice('classic','로마 클래식','아이보리 · 버건디 · 골드','#efe4cf','#803e42','#b08e61')}${themeChoice('night','로마 나이트','차콜 · 웜 골드','#282631','#a57e5a','#d9c5a2')}${themeChoice('modern','미니멀 모던','그레이 · 청록','#e2ebed','#477782','#819fa8')}</div></section><section id="typography" class="settings-panel"><div class="eyebrow">02 / TYPOGRAPHY</div><h2>서체와 가독성</h2><p>기본 서체는 직접 제공하신 Noto Sans KR입니다. 전용 서체 파일을 추가할 수도 있습니다.</p><div class="font-options">${fontChoice('noto','Noto Sans KR')}${fontChoice('serif','명조 (기기 기본)')}${fontChoice('system','시스템 고딕')}${fontChoice('custom','나의 전용 서체')}</div><div class="settings-row"><label for="fontRange">게시글 본문 크기 <strong id="fontSizeText">${config.fontSize}px</strong></label><input id="fontRange" class="range-input" type="range" min="14" max="24" step="1" value="${config.fontSize}" /></div><div class="preview-type"><div class="sample-head">글이 기록으로 남는 순간</div><p>정우라는 이름이 줄바꿈 중간에서 잘리지 않도록, 한글은 가능한 한 어절 단위로 정렬됩니다. 사유의 흔적을 천천히 읽어보세요.</p></div><hr class="settings-divider" /><span class="field-title">전용 서체 파일 등록</span><label class="file-label btn btn-outline btn-sm">서체 파일 선택<input type="file" id="customFontInput" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" aria-label="사용자 서체 파일 업로드" /></label><p class="settings-hint" id="customFontStatus">TTF, OTF, WOFF, WOFF2 형식 지원. 파일은 이 브라우저에 보관됩니다.</p></section><section id="identity" class="settings-panel"><div class="eyebrow">03 / PERSONAL IDENTITY</div><h2>홈페이지 소개</h2><p>블로그 이름, 메인 화면의 문구, 소개글을 자유롭게 고칠 수 있습니다.</p><form id="identityForm"><div class="field"><label for="settingTitle">블로그 이름</label><input type="text" id="settingTitle" maxlength="50" value="${escapeHTML(config.title)}" required /></div><div class="field"><label for="settingTagline">하단 소개 한 줄</label><input type="text" id="settingTagline" maxlength="180" value="${escapeHTML(config.tagline)}" /></div><div class="field"><label for="settingHeroTitle">프롤로그 큰 제목</label><textarea id="settingHeroTitle" rows="2" maxlength="150">${escapeHTML(config.heroTitle)}</textarea></div><div class="field"><label for="settingHeroDescription">프롤로그 설명</label><textarea id="settingHeroDescription" rows="3" maxlength="340">${escapeHTML(config.heroDescription)}</textarea></div><div class="field"><label for="settingAbout">소개 페이지 본문</label><textarea id="settingAbout" rows="7" maxlength="4000">${escapeHTML(config.about)}</textarea></div><button class="btn" type="submit">소개글 저장하기</button></form></section><section id="storage" class="settings-panel"><div class="eyebrow">04 / YOUR DATA</div><h2>백업과 데이터 관리</h2><p>게시글·카테고리·이웃은 Supabase 클라우드에 저장됩니다. 이전 로컬 글은 별도 이전할 수 있습니다.</p><div class="info-banner"><strong>클라우드 연동 안내.</strong><br>공개 글·파일은 Supabase에서 내려받습니다. 이전 로컬 글은 자동으로 공개되지 않으며 관리자 인증 후 이전할 수 있습니다. Google Drive 원본 백업은 아직 수동 작업입니다.</div><div class="settings-actions"><button type="button" id="exportData" class="btn">클라우드 백업 ↓</button><button type="button" id="importData" class="btn btn-outline">백업 복원 ↑</button><button type="button" id="migrateLocalPosts" class="btn btn-outline">이 브라우저의 옛 글 이전 ↑</button></div><hr class="settings-divider" /><p class="field-title">콘텐츠 관리</p><p class="settings-hint">관리자만 게시글을 작성·수정하고, 초안은 방문자에게 표시하지 않습니다.</p></section></div></div></section>`; }
function setActiveNav() {
 const page = (location.hash.match(/^#\/([^/]+)/)||[])[1]||'home';
 $$('.main-nav a').forEach(a=>a.classList.toggle('active',a.dataset.nav===(['post','write'].includes(page)?'posts':page)));
 $('#mainNav').classList.remove('open'); $('#mobileMenu').setAttribute('aria-expanded','false');
}
async function render() {
 const hash=location.hash || '#/home'; const parts=hash.replace(/^#\//,'').split('/'); const route=parts[0];
 clearMediaURLs(); setActiveNav(); currentRoute=route;
 if(route==='home') app.innerHTML=(await home()) + (await window.LIBERNeighbors.homePreview());
 else if(route==='posts') app.innerHTML=await postsPage();
 else if(route==='post') app.innerHTML=await articlePage(decodeURIComponent(parts.slice(1).join('/')));
 else if(route==='write') app.innerHTML=await editorPage(parts.length>1?decodeURIComponent(parts.slice(1).join('/')):null);
 else if(route==='about') app.innerHTML=aboutPage();
 else if(route==='gallery') app.innerHTML=galleryPage();
 else if(route==='neighbors') app.innerHTML=await window.LIBERNeighbors.render();
 else if(route==='categories') app.innerHTML=Cloud.isAdmin()?Cats.page():adminRequiredPage('카테고리 변경은 관리자만 가능합니다.');
 else if(route==='settings') app.innerHTML=settingsPage();
 else if(route==='admin') app.innerHTML=adminPage();
 else app.innerHTML=await home();
 app.classList.remove('is-leaving'); app.classList.remove('page-in'); void app.offsetWidth; app.classList.add('page-in');
 $('#copyrightYear').textContent = new Date().getFullYear();
 if(route==='post') {
  const post=await getPost(decodeURIComponent(parts.slice(1).join('/')));
  Inline.hydrate($('.article-body'),post?.attachments||[],mediaSrc,false);
 }
 if(route==='write') setupEditor();
 if(route==='settings') setupSettings();
 if(route==='posts') {setupSearch();window.LIBERJournalSidebar.setup();}
 if(route==='neighbors') window.LIBERNeighbors.setup();
 if(route==='categories'&&Cloud.isAdmin()) Cats.setup();
 if(route==='admin') setupAdmin();
}
async function pageChange() {
 const seq=++pageSwitchId;
 clearTimeout(leaveTimer);
 app.classList.add('is-leaving');
 leaveTimer=setTimeout(async()=>{ if(seq!==pageSwitchId) return; try { await render(); window.scrollTo({top:0,behavior:'instant'}); } catch(e) { showError(e); } },160);
}
function showError(e) { console.error(e); app.classList.remove('is-leaving'); app.innerHTML=`<div class="container content-section"><div class="empty-state"><strong>화면을 여는 중 문제가 발생했습니다.</strong><p>${escapeHTML(e?.message||'다시 시도해 주세요.')}</p><button class="btn" type="button" onclick="location.reload()">새로고침</button></div></div>`; }
function setupSearch() {
 const input=$('#postSearch'); if(!input) return;
 input.addEventListener('input',async()=>{searchQuery=input.value; const pos=input.selectionStart; const oldY=window.scrollY; const all=await allPosts(false);
  const q=searchQuery.trim().toLocaleLowerCase(), filtered=all.filter(p=>Cats.postMatches(p,activeCategory)&&(!q||[p.title,p.subtitle,txt(p.body),Cats.postName(p),...(p.tags||[])].join(' ').toLocaleLowerCase().includes(q)));
  clearMediaURLs(); $('#postResults').innerHTML=filtered.length?`<div class="post-grid">${filtered.map(card).join('')}</div>`:`<div class="empty-state"><span class="empty-icon">⌕</span><strong>일치하는 글이 없습니다</strong><p>다른 검색어나 카테고리를 선택해 주세요.</p></div>`;
  $('.post-result-label').innerHTML=`검색 결과 <strong>${filtered.length}</strong>개의 글`; window.scrollTo(0,oldY);
 });
}
function setupEditor() {
 const rich=$('#richEditor'); if(!rich) return;
 // Prevent untrusted HTML from being pasted into contenteditable.
 rich.addEventListener('paste',e=>{ e.preventDefault(); const plain=e.clipboardData.getData('text/plain'); rich.focus(); document.execCommand('insertText',false,plain); });
 renderUploadList();
 inlineController=Inline.setupEditor({rich,attachments:()=>editorFiles,createObjectURL:mediaSrc,makeId:uid,onFilesChanged:renderUploadList,notify:toast});
 $('#mediaUpload')?.addEventListener('change',e=>{
  const files=Array.from(e.target.files||[]);
  for(const file of files) {
    if(!(/^(image|video)\//.test(file.type))) { toast('사진과 동영상 파일만 첨부할 수 있습니다.'); continue; }
    if(file.size>150*1024*1024) { toast('150MB를 넘는 파일은 이 체험판에 첨부할 수 없습니다.'); continue; }
    editorFiles.push({id:uid(),name:file.name,type:file.type,blob:file});
  }
  e.target.value=''; renderUploadList();
 });
 $('#saveDraft')?.addEventListener('click',()=>saveEditor(false));
 $('#publishPost')?.addEventListener('click',()=>saveEditor(true));
}
function renderUploadList() {
 const list=$('#uploadList'); if(!list) return;
 list.innerHTML=editorFiles.map(a=>`<div class="upload-item"><span class="upload-name" title="${escapeHTML(a.name)}">${a.type.startsWith('video/')?'🎬':'▧'} ${escapeHTML(a.name)}</span><button class="remove-item" type="button" data-remove-upload="${escapeHTML(a.id)}" title="첨부 삭제" aria-label="${escapeHTML(a.name)} 첨부 삭제">×</button></div>`).join('');
}
async function saveEditor(published) {
 const title=$('#editTitle')?.value.trim(); const body=sanitizeHTML($('#richEditor')?.innerHTML||'');
 if(!title) { toast('게시글 제목을 입력해 주세요.'); $('#editTitle')?.focus(); return; }
 if(!txt(body).trim() && !Inline.ids(body).size) { toast('게시글 본문을 입력해 주세요.'); $('#richEditor')?.focus(); return; }
 const newCat=$('#newCategory')?.value.trim();
 let catId=$('#editCategory')?.value || Cats.byName('posts','기타')?.id;
 if(newCat){
  if(newCat.length>50){ toast('카테고리 이름은 50자 이하로 입력해 주세요.'); return; }
  try { catId=Cats.create('posts',newCat,catId||null).id; }
  catch(e){ toast(e.message); return; }
 }
 const catNode=Cats.find('posts',catId);
 if(!catNode){toast('카테고리를 선택해 주세요.');return;}
 const cat=catNode.name;
 const tags=Array.from(new Set(($('#editTags')?.value||'').split(',').map(t=>t.trim().slice(0,30)).filter(Boolean))).slice(0,8);
 const prev=editorId?await getPost(editorId):null;
 const links=($('#editLinks')?.value||'').split(/\n/).map(x=>x.trim()).filter(Boolean).filter(x=>{try {const u=new URL(x);return ['http:','https:'].includes(u.protocol);}catch{return false;}}).slice(0,20);
 const post={id:prev?.id||uid(),createdAt:prev?.createdAt||Date.now(),updatedAt:Date.now(), title,subtitle:$('#editSubtitle')?.value.trim()||'',category:cat,categoryId:catId,tags,body,attachments:editorFiles.map(a=>({...a})),links,published,demo:false};
 const buttons=[$('#saveDraft'),$('#publishPost')]; buttons.forEach(b=>{if(b)b.disabled=true;});
 try { await putPost(post); editorId=post.id; toast(published?'게시글을 저장했습니다.':'임시저장했습니다.'); location.hash=published?`#/post/${encodeURIComponent(post.id)}`:`#/write/${encodeURIComponent(post.id)}`; if(!published && location.hash===`#/write/${encodeURIComponent(post.id)}`) await render(); }
 catch(err) {console.error(err);toast('저장 실패: 브라우저 저장 용량을 확인해 주세요.');}
 finally {buttons.forEach(b=>{if(b)b.disabled=false;});}
}
function setupSettings() {
 $$('.settings-nav a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault(); const id=a.dataset.settingsAnchor; $$('.settings-nav a').forEach(x=>x.classList.toggle('active',x===a)); document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'}); }));
 const range=$('#fontRange'); range?.addEventListener('input',e=>{config.fontSize=Number(e.target.value);$('#fontSizeText').textContent=`${config.fontSize}px`; writeConfig();});
 $('#identityForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!Cloud.isAdmin()){toast('관리자 로그인이 필요합니다.');location.hash='#/admin';return;}
  const identity={title:$('#settingTitle').value.trim()||defaults.title,tagline:$('#settingTagline').value.trim(),heroTitle:$('#settingHeroTitle').value.trim(),heroDescription:$('#settingHeroDescription').value.trim(),about:$('#settingAbout').value.trim()};
  try{await Cloud.saveSiteIdentity(identity);config={...config,...identity};writeConfig();toast('홈페이지 소개를 Supabase에 저장했습니다.');}
  catch(err){toast('설정 저장 실패: '+err.message);}
 });
 $('#customFontInput')?.addEventListener('change',async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  if(!/\.(woff2?|ttf|otf)$/i.test(file.name)) {toast('TTF, OTF, WOFF, WOFF2 파일을 선택해 주세요.');return;}
  if(file.size>30*1024*1024) {toast('30MB 이하의 서체 파일을 사용해 주세요.');return;}
  try {await assetPut({id:'customFont',blob:file,name:file.name});config.font='custom';await writeConfig();toast('전용 서체를 등록했습니다.');await render();} catch(err){console.error(err);toast('서체 저장에 실패했습니다.');}
 });
 $('#exportData')?.addEventListener('click',exportBackup);
 $('#importData')?.addEventListener('click',()=>$('#backupFile').click());
 $('#migrateLocalPosts')?.addEventListener('click',migrateLocalPosts);
}
function handleClick(e) {
 const cat=e.target.closest('[data-category]'); if(cat) {activeCategory=cat.dataset.category; render().catch(showError);return;}
 const theme=e.target.closest('[data-theme-choice]'); if(theme) {config.theme=theme.dataset.themeChoice;writeConfig();$$('[data-theme-choice]').forEach(el=>{el.classList.toggle('selected',el===theme);el.setAttribute('aria-pressed',String(el===theme));});toast('테마가 변경되었습니다.');return;}
 const font=e.target.closest('[data-font-choice]'); if(font) {if(font.dataset.fontChoice==='custom' && !$('#user-font-style')) {toast('먼저 전용 서체 파일을 등록해 주세요.');$('#customFontInput')?.focus();return;}config.font=font.dataset.fontChoice;writeConfig();$$('[data-font-choice]').forEach(el=>{el.classList.toggle('selected',el===font);el.setAttribute('aria-pressed',String(el===font));});toast('서체가 변경되었습니다.');return;}
 const del=e.target.closest('[data-delete]'); if(del) {if(!Cloud.isAdmin()){toast('관리자 권한이 필요합니다.');return;}deleteArticle(del.dataset.delete);return;}
 const remove=e.target.closest('[data-remove-upload]'); if(remove) {inlineController?.removeById(remove.dataset.removeUpload);editorFiles=editorFiles.filter(f=>f.id!==remove.dataset.removeUpload);renderUploadList();return;}
 const tool=e.target.closest('[data-command], [data-block]'); if(tool) {const editor=$('#richEditor');if(!editor)return;editor.focus();if(tool.dataset.block){document.execCommand('formatBlock',false,tool.dataset.block);}else if(tool.dataset.command==='createLink'){const url=prompt('추가할 웹 주소를 입력해 주세요 (https://...)');if(url && /^https?:\/\//i.test(url)) document.execCommand('createLink',false,url);else if(url)toast('http:// 또는 https:// 주소를 사용해 주세요.');}else document.execCommand(tool.dataset.command,false,null);return;}
}
async function deleteArticle(id) {
 const post=await getPost(id); if(!post) return;
 if(!confirm(`“${post.title}” 게시글을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
 try {await removePost(id);toast('게시글을 삭제했습니다.');location.hash='#/posts';}catch(e){console.error(e);toast('글 삭제에 실패했습니다.');}
}
function blobToDataURL(blob) { return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
function dataURLtoBlob(s) { if(typeof s!=='string'||!s.startsWith('data:'))throw Error('잘못된 미디어 데이터');const [head,base64]=s.split(',');const mime=(head.match(/^data:([^;]+);base64$/)||[])[1];if(!mime||!base64)throw Error('첨부 파일 형식 오류');const raw=atob(base64);const arr=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return new Blob([arr],{type:mime}); }
async function exportBackup() {
 try {
  const posts=await allPosts(), asset=await assetGet('customFont');
  const totalSize=posts.flatMap(p=>p.attachments||[]).reduce((s,x)=>s+(x.blob?.size||0),0);
  if(totalSize>100*1024*1024 && !confirm(`첨부 용량이 약 ${(totalSize/1048576).toFixed(1)}MB입니다. 백업 JSON은 이보다 더 커질 수 있습니다. 계속할까요?`)) return;
  toast('백업 파일을 준비하고 있습니다.');
  const packed=[];
  for(const post of posts){const cp={...post,attachments:[]};for(const a of post.attachments||[])cp.attachments.push({id:a.id,name:a.name,type:a.type,data:a.blob?await blobToDataURL(a.blob):null});packed.push(cp);}
  const packedFont=asset?.blob?{name:asset.name,data:await blobToDataURL(asset.blob)}:null;
  const json=JSON.stringify({format:'LIBER-BACKUP',version:1,createdAt:new Date().toISOString(),config,posts:packed,customFont:packedFont},null,2);
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`LIBER-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);toast('백업 파일 다운로드를 시작했습니다.');
 }catch(err){console.error(err);toast('백업 생성에 실패했습니다.');}
}
async function importBackup(e) {
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 if(!confirm('백업을 복원하시겠습니까? 동일한 ID의 기존 글은 백업 내용으로 대체됩니다.'))return;
 try {
  const data=JSON.parse(await file.text()); if(data.format!=='LIBER-BACKUP'||data.version!==1||!Array.isArray(data.posts)) throw Error('LIBER 백업 형식이 아닙니다.');
  if(data.posts.length>3000) throw Error('게시글 수가 너무 많습니다.');
  let count=0;
  for(const p of data.posts){if(!p.id||typeof p.title!=='string'||typeof p.body!=='string')continue;
   const attaches=[];
   for(const a of (Array.isArray(p.attachments)?p.attachments:[])) {
    if(!a.data)continue; const blob=dataURLtoBlob(a.data);if(!/^(image|video)\//.test(blob.type))continue;
    attaches.push({id:String(a.id||uid()),name:String(a.name||'첨부 파일').slice(0,200),type:blob.type,blob});
   }
   await putPost({id:String(p.id),title:p.title.slice(0,160),subtitle:String(p.subtitle||'').slice(0,250),category:String(p.category||'기타').slice(0,50),categoryId:Cats.find('posts',String(p.categoryId||''))?.id||Cats.byName('posts',p.category)?.id||'',tags:Array.isArray(p.tags)?p.tags.map(x=>String(x).trim().slice(0,30)).filter(Boolean).slice(0,8):[],body:sanitizeHTML(p.body),createdAt:Number(p.createdAt)||Date.now(),updatedAt:Number(p.updatedAt)||Date.now(),published:p.published!==false,demo:p.demo===true,links:Array.isArray(p.links)?p.links.filter(x=>typeof x==='string'&&/^https?:\/\//i.test(x)).slice(0,20):[],attachments:attaches});count++;
  }
  if(data.customFont?.data){const blob=dataURLtoBlob(data.customFont.data);await assetPut({id:'customFont',name:String(data.customFont.name||'custom-font'),blob});}
  if(data.config&&typeof data.config==='object')config={...defaults,...Object.fromEntries(Object.entries(data.config).filter(([k])=>k in defaults))};
  writeConfig();await applyConfig();toast(`${count}개 글을 복원했습니다.`);await render();
 }catch(err){console.error(err);toast(`복원 실패: ${err.message}`);}
}
async function boot() {
 $('#copyrightYear').textContent=new Date().getFullYear();
 try {
  db=await getDB();
  await Cloud.init();
  document.body.classList.toggle('is-liber-admin',Cloud.isAdmin());
  const identity=await Cloud.siteIdentity();
  if(identity&&typeof identity==='object')config={...config,...Object.fromEntries(Object.entries(identity).filter(([key])=>['title','tagline','heroTitle','heroDescription','about'].includes(key)))};
  await Cats.load();await applyConfig();await render();
 }
 catch(err){showError(err);}
 window.addEventListener('hashchange',pageChange);
 $('#mobileMenu').addEventListener('click',()=>{const nav=$('#mainNav');const open=nav.classList.toggle('open');$('#mobileMenu').setAttribute('aria-expanded',String(open));});
 app.addEventListener('mousedown',e=>{if(e.target.closest('.editor-toolbar .tool-btn'))e.preventDefault();});
 app.addEventListener('click',handleClick);
 $('#backupFile').addEventListener('change',importBackup);
 window.LIBERCategoryUsage = async (kind,id,parentId) => {
  if(kind==='neighbors'){window.LIBERNeighbors.reassignCategory?.(id,parentId);return;}
  const target=Cats.find('posts',parentId)||Cats.byName('posts','기타');
  for(const post of await allPosts()) if(Cats.postId(post)===id){post.categoryId=target?.id||'';post.category=target?.name||'기타';await putPost(post);}
 };
}
boot();
})();