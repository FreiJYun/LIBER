/* LIBER — one-way external blogroll. Published entries live in neighbors.json. */
(() => {
  'use strict';
  const DATA_URL = './neighbors.json';
  const DRAFT_KEY = 'liber_neighbors_draft_v1';
  const EDIT_URL = 'https://github.com/FreiJYun/LIBER/edit/main/neighbors.json';
  let published = [], entries = [], loaded = false, hasDraft = false;
  let filter = '전체', query = '', editingId = null, managerOpen = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function safeUrl(value) {
    try {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '';
      return url.href;
    } catch { return ''; }
  }
  function platform(value) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host === 'blog.naver.com' || host === 'm.blog.naver.com') return '네이버 블로그';
      if (host === 'tistory.com' || host.endsWith('.tistory.com')) return '티스토리';
      if (host === 'brunch.co.kr' || host === 'brunchstory.co.kr') return '브런치';
      if (host === 'medium.com' || host.endsWith('.medium.com')) return '미디엄';
      if (host === 'wordpress.com' || host.endsWith('.wordpress.com')) return '워드프레스';
    } catch { /* not a recognized URL */ }
    return '개인 블로그';
  }
  function clean(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const url = safeUrl(raw.url), name = String(raw.name || '').trim().slice(0,80);
    if (!url || !name) return null;
    const avatar = safeUrl(raw.avatar || '');
    return {id: String(raw.id || ('neighbor-' + index)).slice(0,90),
      name, url, avatar, description: String(raw.description || '').trim().slice(0,240)};
  }
  function normalize(items) {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    return items.slice(0, 300).map(clean).filter(item => {
      if (!item || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }
  async function load() {
    if (loaded) return;
    try {
      const response = await fetch(DATA_URL, {cache:'no-store'});
      if (!response.ok) throw Error('이웃 목록 요청 실패');
      const data = await response.json();
      published = normalize(data);
    } catch (error) {
      published = [];
      console.warn('LIBER neighbors: public list unavailable (local file mode may block fetch)',error);
    }
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (saved && Array.isArray(saved.items)) {
        entries = normalize(saved.items);
        hasDraft = true;
      } else entries = published.slice();
    } catch { entries = published.slice(); }
    loaded = true;
  }
  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({items:entries,updatedAt:new Date().toISOString()}));
    hasDraft = true;
  }
  function flash(message) {
    const el = document.querySelector('#toast');
    if (!el) { alert(message); return; }
    el.textContent = message;
    el.classList.add('shown');
    setTimeout(() => el.classList.remove('shown'), 3500);
  }
  function avatar(item, sizeClass) {
    const initial = esc(Array.from(item.name)[0] || '✦');
    return '<span class="neighbor-avatar ' + (sizeClass || '') + '">' +
      '<span class="neighbor-monogram" aria-hidden="true">' + initial + '</span>' +
      (item.avatar ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(item.avatar) + '" alt="" />' : '') +
      '</span>';
  }
  function card(item) {
    return '<article class="neighbor-card">' +
      '<a href="' + esc(item.url) + '" class="neighbor-profile" target="_blank" rel="noopener noreferrer" aria-label="' + esc(item.name) + ' 블로그 열기">' +
      avatar(item,'') +
      '<strong class="neighbor-name">' + esc(item.name) + '</strong>' +
      '<span class="neighbor-platform">' + esc(platform(item.url)) + '</span>' +
      (item.description ? '<span class="neighbor-desc">' + esc(item.description) + '</span>' : '') +
      '<span class="neighbor-visit">블로그 방문 ↗</span></a>' +
      '<div class="neighbor-card-tools">' +
      '<button type="button" data-neighbor-edit="' + esc(item.id) + '" title="이 기기에서 편집">편집</button>' +
      '<button type="button" data-neighbor-delete="' + esc(item.id) + '" title="이 기기의 목록에서 삭제">삭제</button>' +
      '</div></article>';
  }
  function gridHtml() {
    const visible = entries.filter(item => (filter === '전체' || platform(item.url) === filter) &&
      (!query || [item.name, item.description, platform(item.url)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    if (!visible.length) {
      return '<div class="neighbor-empty"><span aria-hidden="true">✧</span><strong>' +
        (entries.length ? '조건에 맞는 이웃이 없습니다' : '아직 등록된 이웃 블로그가 없습니다') +
        '</strong><p>' + (entries.length ? '검색어 또는 플랫폼을 바꿔 보세요.' : '아래 관리 메뉴에서 첫 블로그를 등록해 보세요.') +
        '</p></div>';
    }
    return '<div class="neighbors-grid">' + visible.map(card).join('') + '</div>';
  }
  function filtersHtml() {
    const items = ['전체', ...new Set(entries.map(item => platform(item.url)))];
    return items.map(item => '<button type="button" class="filter-chip ' + (item===filter?'active':'') +
      '" data-neighbor-filter="' + esc(item) + '">' + esc(item) + '</button>').join('');
  }
  function formHtml() {
    const current = entries.find(x => x.id === editingId);
    return '<form id="neighborForm" class="neighbor-form">' +
      '<div class="neighbor-form-grid">' +
      '<label>이웃 이름 또는 별명 <input required maxlength="80" name="name" placeholder="예: 어느 기록자의 서재" value="' + esc(current?.name || '') + '" /></label>' +
      '<label>블로그 주소 <input required name="url" type="url" placeholder="https://blog.naver.com/..." value="' + esc(current?.url || '') + '" /></label>' +
      '<label>한 줄 소개 (선택) <input name="description" maxlength="240" placeholder="어떤 글을 쓰는 블로그인가요?" value="' + esc(current?.description || '') + '" /></label>' +
      '<label>프로필 사진 URL (선택) <input name="avatar" type="url" placeholder="https://.../photo.jpg" value="' + esc(current?.avatar || '') + '" /></label>' +
      '</div><div class="neighbor-form-actions">' +
      '<button class="btn" type="submit">' + (current ? '이웃 수정' : '+ 이웃 추가') + '</button>' +
      (current ? '<button class="btn btn-outline" type="button" id="neighborCancelEdit">수정 취소</button>' : '') +
      '</div></form>';
  }
  async function render() {
    await load();
    return '<section id="neighborsRoot" class="' + (managerOpen ? 'neighbors-managing' : '') + '">' +
      '<section class="page-banner"><div class="container"><div class="eyebrow">MY BLOGROLL · EXTERNAL LINKS</div>' +
      '<h1>이웃의 서재</h1><p>다른 곳에서 만난 좋은 글과 기록자들을 한곳에 모았습니다. 서로이웃 신청 없이, 방문할 수 있는 일방향 링크 모음입니다.</p></div></section>' +
      '<section class="content-section"><div class="container">' +
      '<div class="neighbor-intro"><div><div class="eyebrow">MY NEIGHBORS</div><h2>함께 읽는 블로그</h2>' +
      '<p>프로필을 누르면 해당 네이버 블로그·티스토리·개인 홈페이지로 이동합니다.</p></div>' +
      '<button class="btn btn-outline" type="button" id="neighborOpenManager">+ 이웃 등록·관리</button></div>' +
      (hasDraft ? '<p class="neighbor-draft-warning">현재 보이는 목록에 이 브라우저의 미공개 변경사항이 포함되어 있습니다. 다른 방문자에게 보여 주려면 아래에서 GitHub에 게시하세요.</p>' : '') +
      '<div class="neighbor-toolbar"><div class="filter-chips" id="neighborFilters">' + filtersHtml() + '</div>' +
      '<input id="neighborSearch" class="neighbor-search" type="search" placeholder="이웃 이름·소개 검색" aria-label="이웃 검색" value="' + esc(query) + '" /></div>' +
      '<div id="neighborCards">' + gridHtml() + '</div>' +
      '<details class="neighbor-manager" id="neighborManager" ' + (managerOpen ? 'open' : '') + '>' +
      '<summary>이웃 목록 관리 · 저장 및 공개 안내</summary>' +
      '<div class="neighbor-manager-body"><p>여기서 추가·수정·삭제하면 우선 <strong>이 브라우저에만 임시 저장</strong>됩니다. 공개 블로그에 반영하려면 목록 파일을 GitHub에 게시해야 합니다. 이 화면 자체에는 관리자 로그인이 없습니다.</p>' +
      formHtml() + '<div class="neighbor-publish"><h3>모든 방문자에게 공개하기</h3>' +
      '<p>아래에서 JSON을 복사한 다음 GitHub의 <code>neighbors.json</code> 파일 내용을 교체하고 <strong>Commit changes</strong>를 누르세요. 그러면 GitHub Pages에서 공개 목록이 갱신됩니다.</p>' +
      '<div class="neighbor-form-actions"><button type="button" class="btn" id="neighborCopy">① 목록 JSON 복사</button>' +
      '<a class="btn btn-outline" href="' + EDIT_URL + '" target="_blank" rel="noopener noreferrer">② GitHub 파일 편집 ↗</a>' +
      '<button type="button" class="btn btn-outline" id="neighborDownload">JSON 다운로드</button>' +
      '<button type="button" class="btn btn-outline" id="neighborReset">이 브라우저의 변경 취소</button></div>' +
      '<p class="neighbor-note">주의: 방문자가 수정해도 공개 목록은 바뀌지 않습니다. GitHub 저장소에 커밋할 권한이 있는 사람만 실제 이웃 목록을 게시할 수 있습니다.</p>' +
      '</div></div></details></div></section></section>';
  }
  async function homePreview() {
    await load();
    if (!entries.length) return '';
    return '<section class="section-pad neighbor-home"><div class="container"><div class="section-head">' +
      '<div><div class="eyebrow">VISIT THEIR PAGES</div><h2>이웃의 서재</h2></div>' +
      '<a class="plain-link" href="#/neighbors">모든 이웃 보기 →</a></div>' +
      '<div class="neighbor-home-row">' + entries.slice(0,7).map(item => 
        '<a class="neighbor-home-link" href="' + esc(item.url) +
        '" target="_blank" rel="noopener noreferrer">' +
        avatar(item,'compact') + '<span>' + esc(item.name) + '</span></a>').join('') +
      '</div></div></section>';
  }
  function refresh() {
    const root = document.querySelector('#neighborsRoot');
    if (!root) return;
    managerOpen = !!document.querySelector('#neighborManager')?.open || managerOpen;
    render().then(html => {
      root.outerHTML = html;
      setup();
    }).catch(console.error);
  }
  function setup() {
    const root = document.querySelector('#neighborsRoot');
    if (!root) return;
    const manager = root.querySelector('#neighborManager');
    manager?.addEventListener('toggle', () => {managerOpen = manager.open; root.classList.toggle('neighbors-managing',managerOpen);});
    root.querySelector('#neighborOpenManager')?.addEventListener('click', () => {
      manager.open = true; managerOpen = true;
      manager.scrollIntoView({behavior:'smooth',block:'start'});
    });
    root.querySelector('#neighborSearch')?.addEventListener('input', event => {
      query = event.target.value;
      root.querySelector('#neighborCards').innerHTML = gridHtml();
    });
    root.addEventListener('click', async event => {
      const filterBtn = event.target.closest('[data-neighbor-filter]');
      if (filterBtn) {
        filter = filterBtn.dataset.neighborFilter;
        root.querySelector('#neighborFilters').innerHTML = filtersHtml();
        root.querySelector('#neighborCards').innerHTML = gridHtml();
        return;
      }
      const edit = event.target.closest('[data-neighbor-edit]');
      if (edit) { editingId = edit.dataset.neighborEdit; managerOpen = true; refresh(); setTimeout(() => document.querySelector('#neighborForm input[name="name"]')?.focus(), 30); return; }
      const del = event.target.closest('[data-neighbor-delete]');
      if (del) {
        const item = entries.find(x => x.id === del.dataset.neighborDelete);
        if (item && confirm('“' + item.name + '” 이웃을 이 브라우저의 목록에서 삭제할까요?')) {
          entries = entries.filter(x => x.id !== item.id); saveDraft(); refresh(); flash('이 브라우저에서 삭제했습니다. GitHub에 게시해야 전체 공개 목록이 바뀝니다.');
        }
        return;
      }
      if (event.target.closest('#neighborCancelEdit')) { editingId=null; managerOpen=true;refresh();return; }
      if (event.target.closest('#neighborCopy')) {
        const json = JSON.stringify(entries,null,2) + '\n';
        try { await navigator.clipboard.writeText(json); flash('JSON이 복사되었습니다. GitHub에서 기존 내용을 모두 교체해 주세요.'); }
        catch { flash('복사할 수 없습니다. JSON 다운로드 버튼을 사용해 주세요.'); }
        return;
      }
      if (event.target.closest('#neighborDownload')) {
        const blob = new Blob([JSON.stringify(entries,null,2) + '\n'],{type:'application/json'});
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'neighbors.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url),2000);
        return;
      }
      if (event.target.closest('#neighborReset')) {
        if (!confirm('이 브라우저에서 편집한 이웃 목록을 버리고 GitHub 공개 목록으로 돌아갈까요?')) return;
        localStorage.removeItem(DRAFT_KEY);
        entries = published.slice(); hasDraft = false; editingId=null; filter='전체'; query='';
        refresh(); flash('GitHub 공개 이웃 목록으로 되돌렸습니다.');
      }
    });
    root.querySelector('#neighborForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget, data = new FormData(form);
      const url = safeUrl(data.get('url')), avatarUrl = String(data.get('avatar')||'').trim();
      const name = String(data.get('name')||'').trim();
      if (!name || !url) {flash('이웃 이름과 올바른 블로그 주소를 입력해 주세요.');return;}
      if (avatarUrl && !safeUrl(avatarUrl)) {flash('프로필 이미지 URL을 확인해 주세요.');return;}
      if (entries.some(x => x.url === url && x.id !== editingId)) {flash('이미 등록된 블로그 주소입니다.');return;}
      const item = {id: editingId || 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8),
        name: name.slice(0,80), url, avatar:safeUrl(avatarUrl), description:String(data.get('description')||'').trim().slice(0,240)};
      if (editingId) entries = entries.map(x => x.id===editingId ? item : x);
      else entries.push(item);
      editingId=null; managerOpen=true; filter='전체'; query='';
      saveDraft();refresh();
      flash('이웃을 저장했습니다. 전체 공개하려면 GitHub에 목록을 게시해 주세요.');
    });
    // Invalid external avatar URLs show the monogram instead.
    root.addEventListener('error', event => {
      if (event.target?.matches('.neighbor-avatar img')) event.target.remove();
    }, true);
  }
  window.LIBERNeighbors = {render, setup, homePreview};
})();