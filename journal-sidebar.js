/* LIBER: a Naver-style, accessible category tree for the journal.
   Category data remains owned by LIBERCategories, and posts remain local-first. */
(() => {
  'use strict';
  const Cats = window.LIBERCategories;
  const STORAGE_KEY = 'liber_journal_tree_expanded_v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let expansion = {};
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) expansion = stored;
  } catch { expansion = {}; }

  function isExpanded(item, selected) {
    if (Object.prototype.hasOwnProperty.call(expansion, item.id)) return !!expansion[item.id];
    if (selected !== '전체' && Cats.ancestry('posts', selected).some(n => n.id === item.id)) return true;
    return !item.parentId; // top-level categories open; deep branches start folded
  }
  function treeHTML(posts, selected) {
    const categories = Cats.list('posts');
    const kids = new Map();
    for (const item of categories) {
      const parent = item.parentId || '';
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(item);
    }
    for (const siblings of kids.values()) {
      siblings.sort((a,b)=>(a.order||0)-(b.order||0)||a.name.localeCompare(b.name,'ko'));
    }
    const counts = new Map();
    for (const post of posts) {
      let node = Cats.find('posts', Cats.postId(post));
      const visited = new Set();
      while (node && !visited.has(node.id)) {
        counts.set(node.id, (counts.get(node.id)||0)+1);
        visited.add(node.id);
        node = Cats.find('posts',node.parentId);
      }
    }
    const all = '<li class="journal-cat-item"><div class="journal-cat-row journal-cat-all' +
      (selected === '전체'?' selected':'') +
      '"><span class="journal-cat-toggle-spacer" aria-hidden="true"></span>' +
      '<button type="button" class="journal-cat-select" data-category="전체"' +
      (selected==='전체'?' aria-current="true"':'') +
      '><span class="journal-cat-icon" aria-hidden="true">▤</span>' +
      '<span class="journal-cat-text">전체 보기</span><span class="journal-cat-count">' + posts.length + '</span>' +
      '</button></div></li>';
    const visited = new Set();
    function branch(parent) {
      return (kids.get(parent)||[]).map(item=>{
        if (visited.has(item.id)) return '';
        visited.add(item.id);
        const children = (kids.get(item.id)||[]);
        const hasChildren = children.length>0;
        const open = hasChildren && isExpanded(item,selected);
        const label = esc(item.name);
        const toggle = hasChildren
          ? '<button type="button" class="journal-cat-toggle" data-journal-toggle="' + esc(item.id) +
            '" aria-expanded="' + String(open) + '" aria-label="' + label + (open?' 접기':' 펼치기') +
            '"><span aria-hidden="true">' + (open?'▾':'▸') + '</span></button>'
          : '<span class="journal-cat-toggle-spacer" aria-hidden="true"></span>';
        return '<li class="journal-cat-item">' +
          '<div class="journal-cat-row' + (selected===item.id?' selected':'') + '">' +
          toggle +
          '<button type="button" class="journal-cat-select" data-category="' + esc(item.id) +
          '" title="' + esc(Cats.breadcrumb('posts',item.id)) + '"' +
          (selected===item.id?' aria-current="true"':'') + '>' +
          '<span class="journal-cat-icon ' + (hasChildren?'is-folder':'') +
          '" aria-hidden="true">' + (hasChildren?'▣':'▤') + '</span>' +
          '<span class="journal-cat-text">' + label + '</span>' +
          '<span class="journal-cat-count">' + (counts.get(item.id)||0) + '</span>' +
          '</button></div>' +
          (hasChildren ? '<ul class="journal-cat-children"' + (open?'':' hidden') + '>' + branch(item.id) + '</ul>' : '') +
          '</li>';
      }).join('');
    }
    return '<ul class="journal-cat-list">' + all + branch('') + '</ul>';
  }
  function render(posts,selected='전체') {
    const name = selected==='전체' ? '전체 카테고리' : Cats.breadcrumb('posts',selected) || '전체 카테고리';
    return '<aside class="journal-sidebar" aria-label="게시글 카테고리">' +
      '<div class="journal-sidebar-box">' +
      '<div class="journal-sidebar-heading"><div><span class="journal-sidebar-overline">INDEX RERVM</span>' +
      '<h2>카테고리</h2></div>' +
      '<a href="#/categories" class="journal-sidebar-edit" title="카테고리 추가·수정·삭제">관리 ↗</a></div>' +
      '<button type="button" class="journal-mobile-category-toggle" aria-controls="journalCategoryTree" aria-expanded="false">' +
      '<span class="journal-mobile-folder" aria-hidden="true">▤</span>' +
      '<span class="journal-mobile-category-label">' + esc(name) + '</span>' +
      '<span class="journal-mobile-chevron" aria-hidden="true">▾</span></button>' +
      '<nav id="journalCategoryTree" class="journal-category-tree" aria-label="게시글 분류 선택">' +
      treeHTML(posts,selected) +
      '</nav></div></aside>';
  }
  function setup() {
    const sidebar = document.querySelector('.journal-sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('click',event=>{
      const toggle = event.target.closest('[data-journal-toggle]');
      if(toggle) {
        const id = toggle.dataset.journalToggle;
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        expansion[id] = open;
        try {localStorage.setItem(STORAGE_KEY,JSON.stringify(expansion));}catch{}
        toggle.setAttribute('aria-expanded',String(open));
        const text = toggle.closest('.journal-cat-row')?.querySelector('.journal-cat-text')?.textContent||'카테고리';
        toggle.setAttribute('aria-label',text+(open?' 접기':' 펼치기'));
        const caret = toggle.querySelector('span');
        if(caret) caret.textContent = open?'▾':'▸';
        const next = toggle.closest('.journal-cat-item')?.querySelector(':scope > .journal-cat-children');
        if(next) next.hidden = !open;
        return;
      }
      const mobile = event.target.closest('.journal-mobile-category-toggle');
      if(mobile) {
        const open = mobile.getAttribute('aria-expanded')!=='true';
        mobile.setAttribute('aria-expanded',String(open));
        sidebar.classList.toggle('mobile-expanded',open);
      }
    });
  }
  window.LIBERJournalSidebar = {render,setup};
})();