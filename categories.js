/* LIBER category hierarchies: Supabase-backed public tree with offline draft recovery. */
(() => {
'use strict';
const DATA_URL = './categories.json', KEY = 'liber_category_draft_v1';
const KINDS = ['posts','neighbors'];
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const basic = {
 posts:[{id:'p-philosophy',name:'철학',parentId:null},{id:'p-ethics',name:'윤리학',parentId:'p-philosophy'},{id:'p-history',name:'역사',parentId:null},{id:'p-rome',name:'고대 로마',parentId:'p-history'},{id:'p-reading',name:'독서',parentId:null},{id:'p-technology',name:'기술',parentId:null},{id:'p-life',name:'일상',parentId:null},{id:'p-other',name:'기타',parentId:null}],
 neighbors:[{id:'n-philosophy',name:'철학',parentId:null},{id:'n-history',name:'역사',parentId:null},{id:'n-life',name:'일상',parentId:null},{id:'n-technology',name:'학술·기술',parentId:null},{id:'n-other',name:'기타',parentId:null}]
};
let ready=false, publicData=null, data=null, dirty=false, kind='posts', selected='', managerAlert='', syncQueue=Promise.resolve();
function normalizeList(raw) {
 if(!Array.isArray(raw))return [];
 const out=[], seen=new Set();
 raw.slice(0,500).forEach((item,i)=>{
  if(!item || typeof item!=='object') return;
  const id=String(item.id||'').trim().slice(0,100), name=String(item.name||'').trim().slice(0,50);
  if(!id||!name||seen.has(id))return;
  seen.add(id);
  out.push({id,name,parentId:item.parentId===null?null:String(item.parentId||'').slice(0,100)||null,order:Number.isFinite(Number(item.order))?Number(item.order):i});
 });
 // Repair dangling parents, self-parents and cycles.
 for(const node of out) {
  if(node.parentId&&!seen.has(node.parentId))node.parentId=null;
  const visited=new Set([node.id]);let current=node;
  while(current.parentId) {
   if(visited.has(current.parentId)){node.parentId=null;break;}
   visited.add(current.parentId);
   current=out.find(x=>x.id===current.parentId);
   if(!current)break;
  }
 }
 return out;
}
function normalize(payload) {
 const source=payload&&typeof payload==='object'?payload:{};
 return Object.fromEntries(KINDS.map(k=>[k,normalizeList(Array.isArray(source[k])?source[k]:basic[k])]));
}
async function load(){
 if(ready)return;
 let remote=null;
 if(window.LIBERCloud?.ready()) remote=await window.LIBERCloud.listCategories();
 else {const response=await fetch(DATA_URL,{cache:'no-store'});if(response.ok)remote=await response.json();}
 publicData=normalize(remote);data=structuredClone(publicData);
 if(window.LIBERCloud?.isAdmin()){
  try{const cached=JSON.parse(localStorage.getItem(KEY)||'null');if(cached&&cached.posts&&cached.neighbors){data=normalize(cached);dirty=true;}}
  catch(e){console.warn('Category draft error',e);}
 }
 ready=true;
}
function list(k){return data?.[KINDS.includes(k)?k:'posts']||[];}
function ordered(k){
 const cats=list(k),result=[],visited=new Set();
 function walk(parentId,depth){
  cats.filter(x=>x.parentId===parentId).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ko')).forEach(x=>{
   if(visited.has(x.id))return;visited.add(x.id);result.push({...x,depth});walk(x.id,depth+1);
  });
 }
 walk(null,0);return result;
}
function find(k,id){return list(k).find(x=>x.id===id)||null;}
function ancestry(k,id){const nodes=[],seen=new Set();let current=find(k,id);while(current&&!seen.has(current.id)){nodes.unshift(current);seen.add(current.id);current=find(k,current.parentId);}return nodes;}
function breadcrumb(k,id){return ancestry(k,id).map(x=>x.name).join(' › ');}
function descendants(k,id){const ids=new Set([id]);let old=0;while(old!==ids.size){old=ids.size;list(k).forEach(x=>{if(ids.has(x.parentId))ids.add(x.id);});}return ids;}
function byName(k,name){return ordered(k).find(x=>x.name===name)||null;}
function postId(post){return find('posts',post?.categoryId)?.id||byName('posts',post?.category)?.id||'';}
function postName(post){const id=postId(post);return (id?breadcrumb('posts',id):String(post?.category||'기타'));}
function postMatches(post,filterId){
 if(!filterId||filterId==='전체')return true;
 const pid=postId(post);
 return !!pid&&descendants('posts',filterId).has(pid);
}
function options(k,current='',exclude=new Set()){
 return ordered(k).filter(x=>!exclude.has(x.id)).map(x=>'<option value="'+esc(x.id)+'" '+(current===x.id?'selected':'')+'>'+'　'.repeat(x.depth)+'↳ '+esc(x.name)+'</option>').join('');
}
function filterButtons(k,active='전체'){
 return '<button type="button" class="filter-chip '+(active==='전체'?'active':'')+'" data-category="전체">전체</button>' +
 ordered(k).map(x=>'<button type="button" class="filter-chip '+(x.id===active?'active':'')+'" data-category="'+esc(x.id)+'" title="'+esc(breadcrumb(k,x.id))+'" style="--category-depth:'+x.depth+'">'+
 (x.depth?'└ '.repeat(Math.min(x.depth,3)):'')+esc(x.name)+'</button>').join('');
}
function persist(){
 const snapshot=JSON.stringify(data);
 try{localStorage.setItem(KEY,snapshot);dirty=true;}
 catch(e){alert('카테고리 임시 저장에 실패했습니다.');throw e;}
 if(window.LIBERCloud?.isAdmin()){
  syncQueue=syncQueue.catch(()=>{}).then(async()=>{
   await window.LIBERCloud.saveCategories(JSON.parse(snapshot));
   if(localStorage.getItem(KEY)===snapshot){
    localStorage.removeItem(KEY);publicData=normalize(JSON.parse(snapshot));dirty=false;
   }
  }).catch(error=>{console.error('Category sync failed',error);managerAlert='클라우드 저장 실패: '+error.message;});
 }
}
function sync(){return syncQueue;}
function uniqueName(k,name,parentId,exceptId=''){return !list(k).some(x=>x.id!==exceptId&&x.parentId===parentId&&x.name===name);}
function create(k,name,parentId=null){
 name=String(name||'').trim().slice(0,50);
 if(!name||!KINDS.includes(k))throw Error('카테고리 이름을 입력해 주세요.');
 if(parentId&&!find(k,parentId))throw Error('상위 카테고리를 찾을 수 없습니다.');
 if(!uniqueName(k,name,parentId))throw Error('같은 위치에 동일한 이름이 있습니다.');
 if(list(k).length>=500)throw Error('최대 500개까지 등록할 수 있습니다.');
 const item={id:'c-'+(crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),name,parentId,order:Math.max(-1,...list(k).filter(x=>x.parentId===parentId).map(x=>x.order))+1};
 list(k).push(item);persist();return item;
}
function update(k,id,name,parentId){
 const item=find(k,id);if(!item)throw Error('카테고리를 찾지 못했습니다.');
 name=String(name||'').trim().slice(0,50);
 if(!name)throw Error('이름을 입력해 주세요.');
 if(parentId&&!find(k,parentId))throw Error('상위 카테고리가 없습니다.');
 if(parentId&&descendants(k,id).has(parentId))throw Error('카테고리를 자기 자신이나 하위 카테고리 아래로 이동할 수 없습니다.');
 if(!uniqueName(k,name,parentId,id))throw Error('같은 위치에 동일한 이름이 있습니다.');
 if(item.parentId!==parentId)item.order=Math.max(-1,...list(k).filter(x=>x.parentId===parentId).map(x=>x.order))+1;
 item.name=name;item.parentId=parentId;persist();
}
function move(k,id,offset){
 const item=find(k,id);if(!item)return;
 const siblings=list(k).filter(x=>x.parentId===item.parentId).sort((a,b)=>a.order-b.order);
 const index=siblings.findIndex(x=>x.id===id),other=siblings[index+offset];
 if(!other)return;
 siblings.forEach((s,i)=>s.order=i);
 const a=item.order;item.order=other.order;other.order=a;persist();
}
function sortedSiblings(k,parentId){
 return list(k).filter(x=>x.parentId===parentId).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ko'));
}
function moveToIndex(k,id,index){
 const item=find(k,id);if(!item)return false;
 const original=sortedSiblings(k,item.parentId);
 const current=original.findIndex(x=>x.id===id);
 const target=Math.max(0,Math.min(original.length-1,index));
 if(current===target)return false;
 original.splice(current,1);
 original.splice(target,0,item);
 original.forEach((x,i)=>x.order=i);
 persist();return true;
}
function moveToEdge(k,id,edge){
 const item=find(k,id);if(!item)return false;
 return moveToIndex(k,id,edge==='first'?0:sortedSiblings(k,item.parentId).length-1);
}
function moveRelative(k,sourceId,targetId,after){
 const source=find(k,sourceId),target=find(k,targetId);
 if(!source||!target||source.id===target.id||source.parentId!==target.parentId)return false;
 const original=sortedSiblings(k,source.parentId);
 const siblings=original.filter(x=>x.id!==sourceId);
 const position=siblings.findIndex(x=>x.id===targetId);
 if(position<0)return false;
 siblings.splice(position+(after?1:0),0,source);
 if(original.every((x,i)=>x.id===siblings[i].id))return false;
 siblings.forEach((x,i)=>x.order=i);
 persist();return true;
}
async function erase(k,id){
 const item=find(k,id);if(!item)return;
 if(list(k).some(x=>x.parentId===id))throw Error('먼저 하위 카테고리를 다른 곳으로 이동하거나 삭제해 주세요.');
 const parent=item.parentId;
 if(!confirm('“'+item.name+'” 카테고리를 삭제할까요?\n게시글은 상위 카테고리(없으면 기타)로 이동하고 이웃의 해당 분류는 제거됩니다.'))return;
 if(window.LIBERCategoryUsage) await window.LIBERCategoryUsage(k,id,parent,item.name);
 data[k]=list(k).filter(x=>x.id!==id);persist();selected='';managerAlert='카테고리 삭제를 Supabase에 반영 중입니다.';
}
const alertMessage=message=>{managerAlert=message;};
function page(){
 const nodes=ordered(kind),item=find(kind,selected);
 const exclude=item?descendants(kind,item.id):new Set();
 const parentOptions='<option value="">최상위 카테고리</option>'+options(kind,item?.parentId||'',exclude);
 return '<section class="page-banner"><div class="container"><div class="eyebrow">CATEGORY ARCHIVE · TAXONOMY</div><h1>카테고리 관리</h1><p>철학·역사·일상에서 더 깊은 하위 분류까지. 글과 이웃을 구분해 자유롭게 정리합니다.</p></div></section>'+
 '<section class="content-section"><div class="container"><div class="category-manager-intro"><p>카테고리는 단계 제한 없이 만들 수 있습니다. 상위 분류를 선택하면 하위 분류까지 함께 조회됩니다.</p>'+
 (dirty?'<p class="neighbor-draft-warning">이전 카테고리 초안이 있습니다. 변경 시 Supabase에 저장됩니다.</p>':'')+
 (managerAlert?'<p class="category-feedback" role="status">'+esc(managerAlert)+'</p>':'')+'</div>'+
 '<div class="category-tabs" role="group" aria-label="카테고리 종류"><button type="button" data-category-kind="posts" class="'+(kind==='posts'?'active':'')+'">게시글 카테고리</button><button type="button" data-category-kind="neighbors" class="'+(kind==='neighbors'?'active':'')+'">이웃 카테고리</button></div>'+
 '<div class="category-manager-grid"><section class="panel category-tree-panel"><div class="category-tree-head"><h2>분류 목록</h2><button class="btn btn-sm btn-outline" type="button" id="categoryNewRoot">+ 최상위 추가</button></div>'+
 '<p class="category-drag-hint">⠿ 카테고리를 끌어 순서를 바꿀 수 있습니다. 같은 단계끼리 이동합니다.</p><div class="category-tree-list" role="list">'+(nodes.length?nodes.map(x=>'<button type="button" role="listitem" draggable="true" data-cat-select="'+esc(x.id)+'" class="category-tree-row '+(selected===x.id?'active':'')+'" style="--category-depth:'+Math.min(x.depth,12)+'"><span class="category-tree-drag-mark" aria-hidden="true">⠿</span><span class="category-tree-mark">'+(nodes.some(y=>y.parentId===x.id)?'▾':'·')+'</span><span>'+esc(x.name)+'</span></button>').join(''):'<p>카테고리가 없습니다. 최상위 분류를 추가해 주세요.</p>')+'</div></section>'+
 '<section class="panel category-edit-panel"><h2>'+ (item?'카테고리 편집':'새 카테고리 추가')+'</h2><form id="categoryManageForm"><label class="category-label">이름<input id="catName" name="name" required maxlength="50" placeholder="예: 로마 공화정" value="'+esc(item?.name||'')+'"></label>'+
 '<label class="category-label">상위 카테고리<select id="catParent" name="parentId">'+parentOptions+'</select></label>'+
 '<div class="category-actions"><button class="btn" type="submit">'+(item?'변경 저장':'+ 추가')+'</button>'+
 (item?'<button class="btn btn-outline" type="button" id="categoryAddChild">+ 하위 추가</button><button class="btn btn-outline" type="button" id="categoryMoveFirst">⇤ 맨 위로</button><button class="btn btn-outline" type="button" id="categoryMoveUp">↑ 위로</button><button class="btn btn-outline" type="button" id="categoryMoveDown">↓ 아래로</button><button class="btn btn-outline" type="button" id="categoryMoveLast">⇥ 맨 아래로</button><button class="btn btn-outline" type="button" id="categoryDelete">삭제</button>':'')+'</div></form><p class="category-tip">'+(item?esc(breadcrumb(kind,item.id)):'왼쪽에서 분류를 선택해 수정하거나, 이름을 입력해 새 분류를 만드세요.')+'</p></section></div>'+
 '<div class="neighbor-publish category-publish"><h2>클라우드 저장 및 백업</h2><p>카테고리 변경은 Supabase에 자동 저장됩니다. JSON 내보내기는 별도 백업용으로 사용하세요.</p>'+
 '<div class="neighbor-form-actions"><button class="btn" type="button" id="categoryCopy">① JSON 복사</button><a class="btn btn-outline" target="_blank" rel="noopener noreferrer" href="https://supabase.com/dashboard/project/muwvbthekagigehnywjx/editor">② Supabase 목록 확인 ↗</a><button class="btn btn-outline" type="button" id="categoryDownload">JSON 다운로드</button><button class="btn btn-outline" type="button" id="categoryReset">로컬 변경 취소</button></div></div></div></section>';
}
function refresh(){
 const root=document.querySelector('#app');if(!root)return;
 root.innerHTML=page();setup();
}
function notice(message){alertMessage(message);refresh();}
function setup(){
 const root=document.querySelector('#app');if(!root)return;
 root.querySelectorAll('[data-category-kind]').forEach(button=>button.addEventListener('click',()=>{
  kind=button.dataset.categoryKind;selected='';managerAlert='';refresh();
 }));
 root.querySelectorAll('[data-cat-select]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.catSelect;managerAlert='';refresh();}));
 root.querySelector('#categoryNewRoot')?.addEventListener('click',()=>{selected='';managerAlert='';refresh();root.querySelector('#catName')?.focus();});
 root.querySelector('#categoryAddChild')?.addEventListener('click',()=>{
  const parent=selected;selected='';refresh();root.querySelector('#catParent').value=parent;root.querySelector('#catName').focus();
 });
 root.querySelector('#categoryManageForm')?.addEventListener('submit',event=>{
  event.preventDefault();const name=root.querySelector('#catName').value.trim(),parentId=root.querySelector('#catParent').value||null;
  try{if(selected)update(kind,selected,name,parentId);else selected=create(kind,name,parentId).id;notice('Supabase에 카테고리 저장을 요청했습니다.');}catch(e){alert(e.message);}
 });
 root.querySelector('#categoryMoveUp')?.addEventListener('click',()=>{move(kind,selected,-1);refresh();});
 root.querySelector('#categoryMoveDown')?.addEventListener('click',()=>{move(kind,selected,1);refresh();});
 root.querySelector('#categoryMoveFirst')?.addEventListener('click',()=>{
  if(moveToEdge(kind,selected,'first'))notice('선택한 카테고리를 같은 단계의 맨 위로 옮겼습니다.');else refresh();
 });
 root.querySelector('#categoryMoveLast')?.addEventListener('click',()=>{
  if(moveToEdge(kind,selected,'last'))notice('선택한 카테고리를 같은 단계의 맨 아래로 옮겼습니다.');else refresh();
 });
 let draggedId=null;
 const tree=root.querySelector('.category-tree-list');
 const clearHover=()=>tree?.querySelectorAll('.drag-before,.drag-after').forEach(el=>el.classList.remove('drag-before','drag-after'));
 tree?.addEventListener('dragstart',event=>{
  const row=event.target.closest('[data-cat-select]');
  if(!row)return;
  draggedId=row.dataset.catSelect;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',draggedId);
  row.classList.add('dragging');
 });
 tree?.addEventListener('dragover',event=>{
  const row=event.target.closest('[data-cat-select]');
  if(!row||!draggedId||row.dataset.catSelect===draggedId)return;
  const a=find(kind,draggedId),b=find(kind,row.dataset.catSelect);
  if(!a||!b||a.parentId!==b.parentId)return;
  event.preventDefault();
  event.dataTransfer.dropEffect='move';
  clearHover();
  const rect=row.getBoundingClientRect();
  row.classList.add(event.clientY>rect.top+rect.height/2?'drag-after':'drag-before');
 });
 tree?.addEventListener('drop',event=>{
  const row=event.target.closest('[data-cat-select]');
  if(!row||!draggedId)return;
  const sourceId=draggedId,targetId=row.dataset.catSelect;
  const a=find(kind,sourceId),b=find(kind,targetId);
  if(!a||!b||a.parentId!==b.parentId){
   clearHover();return;
  }
  event.preventDefault();
  const rect=row.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2;
  draggedId=null;
  if(moveRelative(kind,sourceId,targetId,after)){selected=sourceId;notice('카테고리 순서를 Supabase에 저장 중입니다.');}
  else refresh();
 });
 tree?.addEventListener('dragend',()=>{
  draggedId=null;clearHover();tree.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));
 });
 root.querySelector('#categoryDelete')?.addEventListener('click',async()=>{
  try{await erase(kind,selected);refresh();}catch(e){alert(e.message);}
 });
 root.querySelector('#categoryCopy')?.addEventListener('click',async()=>{
  const result=JSON.stringify(data,null,2)+'\n';
  try{await navigator.clipboard.writeText(result);notice('JSON이 복사되었습니다. 필요할 때 JSON을 백업으로 보관해 주세요.');}
  catch{notice('복사할 수 없습니다. JSON 다운로드를 이용해 주세요.');}
 });
 root.querySelector('#categoryDownload')?.addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='categories.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);
 });
 root.querySelector('#categoryReset')?.addEventListener('click',()=>{
  if(!confirm('이 브라우저에서 변경한 카테고리 목록을 버리고 클라우드 공개 목록으로 되돌릴까요?'))return;
  localStorage.removeItem(KEY);data=structuredClone(publicData);dirty=false;selected='';notice('공개 카테고리 목록으로 복원했습니다.');
 });
}
window.LIBERCategories={load,page,setup,sync,list,ordered,find,ancestry,breadcrumb,descendants,byName,postId,postName,postMatches,options,filterButtons,create,isDirty:()=>dirty,
 neighborsMatch:(ids,catId)=>catId==='전체'||!catId||(Array.isArray(ids)&&ids.some(id=>descendants('neighbors',catId).has(id)))};
})();