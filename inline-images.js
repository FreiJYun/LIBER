/* LIBER inline images — local-first and safe. Images reference existing post attachments by ID. */
(() => {
  'use strict';
  const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
  const allowedWidths = new Set(['100','75','50']);
  const allowedAligns = new Set(['left','center','right']);
  const cleanWidth = value => allowedWidths.has(String(value)) ? String(value) : '100';
  const cleanAlign = value => allowedAligns.has(String(value)) ? String(value) : 'center';
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function cleanMarker(node) {
    const id = String(node.getAttribute('data-photo-id') || '');
    if(!idPattern.test(id))return document.createDocumentFragment();
    const out = document.createElement('span');
    out.setAttribute('data-photo-id',id);
    out.setAttribute('data-photo-width',cleanWidth(node.getAttribute('data-photo-width')));
    out.setAttribute('data-photo-align',cleanAlign(node.getAttribute('data-photo-align')));
    out.setAttribute('data-photo-caption',String(node.getAttribute('data-photo-caption')||'').slice(0,200));
    return out;
  }
  function ids(html) {
    const doc=document.createElement('template');
    doc.innerHTML=html||'';
    return new Set(Array.from(doc.content.querySelectorAll('span[data-photo-id]'))
      .map(node=>node.getAttribute('data-photo-id')).filter(id=>idPattern.test(id)));
  }
  function hydrate(root,attachments,objectURL,editable=false) {
    if(!root)return;
    const byId=new Map((attachments||[]).filter(x=>x?.id&&(x.blob||x.remoteUrl)&&/^image\//.test(x.type||'')).map(x=>[String(x.id),x]));
    root.querySelectorAll('span[data-photo-id]').forEach(marker=>{
      const id=marker.getAttribute('data-photo-id'),item=byId.get(id);
      marker.replaceChildren();
      marker.className='liber-inline-photo';
      marker.setAttribute('contenteditable','false');
      if(editable){marker.setAttribute('draggable','true');marker.setAttribute('role','button');marker.setAttribute('tabindex','0');marker.setAttribute('aria-label','사진 선택 및 설정');}
      else{marker.removeAttribute('draggable');marker.removeAttribute('role');marker.removeAttribute('tabindex');}
      marker.dataset.photoWidth=cleanWidth(marker.dataset.photoWidth);
      marker.dataset.photoAlign=cleanAlign(marker.dataset.photoAlign);
      if(item) {
        const img=document.createElement('img');
        img.src=objectURL(item);
        img.alt=item.name||'본문 사진';
        img.loading=editable?'eager':'lazy';
        img.draggable=false;
        marker.appendChild(img);
      } else {
        const fallback=document.createElement('span');
        fallback.className='liber-inline-photo-missing';
        fallback.textContent='사진 파일을 찾을 수 없습니다.';
        marker.appendChild(fallback);
      }
      const caption=String(marker.dataset.photoCaption||'').slice(0,200);
      if(caption||editable){
        const el=document.createElement('span');
        el.className='liber-inline-photo-caption';
        el.textContent=caption||(editable?'사진을 선택하면 설명을 입력할 수 있습니다.':'');
        marker.appendChild(el);
      }
    });
  }

  function setupEditor({rich,attachments,createObjectURL,makeId,onFilesChanged,notify}) {
    const fileInput=document.querySelector('#inlinePhotoInput');
    const insertButton=document.querySelector('#insertInlinePhoto');
    const panel=document.querySelector('#inlinePhotoControls');
    const captionInput=document.querySelector('#inlinePhotoCaption');
    const widthInput=document.querySelector('#inlinePhotoWidth');
    const alignInput=document.querySelector('#inlinePhotoAlign');
    if(!rich||!fileInput||!insertButton||!panel)return;
    hydrate(rich,attachments(),createObjectURL,true);
    let selected=null, caretRange=null,draggingId=null;
    function selectionRange(){
      const selection=window.getSelection();
      if(selection?.rangeCount){
        const range=selection.getRangeAt(0);
        if(rich.contains(range.commonAncestorContainer))return range.cloneRange();
      }
      return null;
    }
    function rememberCaret(){
      const range=selectionRange();
      if(range)caretRange=range;
    }
    function showPanel(marker){
      rich.querySelectorAll('.liber-inline-photo.is-selected').forEach(el=>el.classList.remove('is-selected'));
      selected=marker&&rich.contains(marker)?marker:null;
      panel.hidden=!selected;
      if(!selected)return;
      selected.classList.add('is-selected');
      captionInput.value=selected.dataset.photoCaption||'';
      widthInput.value=cleanWidth(selected.dataset.photoWidth);
      alignInput.value=cleanAlign(selected.dataset.photoAlign);
    }
    function previewCaption(marker){
      const el=marker.querySelector('.liber-inline-photo-caption');
      if(el)el.textContent=marker.dataset.photoCaption||'사진을 선택하면 설명을 입력할 수 있습니다.';
    }
    rich.addEventListener('mouseup',rememberCaret);
    rich.addEventListener('keyup',rememberCaret);
    rich.addEventListener('click',event=>{
      const marker=event.target.closest('.liber-inline-photo');
      if(marker&&rich.contains(marker)){event.preventDefault();showPanel(marker);}
      else showPanel(null);
    });
    rich.addEventListener('keydown',event=>{
      const marker=event.target.closest?.('.liber-inline-photo');
      if(marker&&(event.key==='Enter'||event.key===' ')){event.preventDefault();showPanel(marker);}
      if(marker&&(event.key==='Delete'||event.key==='Backspace')){event.preventDefault();removeSelected();}
    });
    insertButton.addEventListener('click',()=>{
      caretRange=selectionRange()||caretRange;
      fileInput.click();
    });
    fileInput.addEventListener('change',async event=>{
      const files=Array.from(event.target.files||[]);
      event.target.value='';
      if(!files.length)return;
      const range=caretRange?.cloneRange()||document.createRange();
      if(!rich.contains(range.commonAncestorContainer)){
        range.selectNodeContents(rich);range.collapse(false);
      }
      let count=0;
      for(const file of files){
        if(!['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'].includes(file.type)){
          notify('JPG·PNG·WebP·GIF 사진 또는 변환 가능한 HEIC 사진을 선택해 주세요.');continue;
        }
        if(file.size>50*1024*1024){
          notify('본문 사진은 파일당 50MB 이하여야 합니다.');continue;
        }
        const id=makeId();
        attachments().push({id,name:file.name,type:file.type,blob:file});
        const marker=document.createElement('span');
        marker.dataset.photoId=id;
        marker.dataset.photoWidth='100';
        marker.dataset.photoAlign='center';
        marker.dataset.photoCaption='';
        marker.contentEditable='false';
        range.deleteContents();
        range.insertNode(marker);
        range.setStartAfter(marker);
        range.collapse(true);
        count++;
      }
      if(!count)return;
      // Keep an editable paragraph after a photo inserted at the very end.
      if(rich.lastChild?.nodeType===Node.ELEMENT_NODE && rich.lastChild.matches?.('span[data-photo-id]')){
        const paragraph=document.createElement('p');
        paragraph.appendChild(document.createElement('br'));
        rich.appendChild(paragraph);
        range.selectNodeContents(paragraph);
        range.collapse(true);
      }
      caretRange=range.cloneRange();
      const selection=window.getSelection();
      rich.focus();
      if(selection){selection.removeAllRanges();selection.addRange(range);}
      hydrate(rich,attachments(),createObjectURL,true);
      onFilesChanged();
      notify(count+'개의 사진을 본문에 넣었습니다. 사진을 선택하면 크기·정렬·설명을 수정할 수 있습니다.');
    });
    captionInput.addEventListener('input',()=>{
      if(!selected)return;
      selected.dataset.photoCaption=captionInput.value.slice(0,200);
      previewCaption(selected);
    });
    widthInput.addEventListener('change',()=>{
      if(selected)selected.dataset.photoWidth=cleanWidth(widthInput.value);
    });
    alignInput.addEventListener('change',()=>{
      if(selected)selected.dataset.photoAlign=cleanAlign(alignInput.value);
    });
    function removeSelected(){
      if(!selected)return;
      const id=selected.dataset.photoId;
      selected.remove();
      showPanel(null);
      if(!rich.querySelector('span[data-photo-id="'+CSS.escape(id)+'"]')){
        const files=attachments();
        const index=files.findIndex(x=>String(x.id)===id);
        if(index>=0)files.splice(index,1);
        onFilesChanged();
      }
    }
    document.querySelector('#inlinePhotoRemove')?.addEventListener('click',removeSelected);
    function moveRelative(direction){
      if(!selected)return;
      const parent=selected.parentElement;
      // Move the image to the preceding or following editable block.
      const sibling=direction<0?parent?.previousElementSibling:parent?.nextElementSibling;
      if(sibling&&rich.contains(sibling)){
        if(direction<0)sibling.insertBefore(selected,sibling.firstChild);
        else sibling.appendChild(selected);
        selected.scrollIntoView({behavior:'smooth',block:'nearest'});
      }else notify('더 이동할 문단이 없습니다. 원하는 위치로 사진을 끌어서 이동할 수도 있습니다.');
    }
    document.querySelector('#inlinePhotoMoveUp')?.addEventListener('click',()=>moveRelative(-1));
    document.querySelector('#inlinePhotoMoveDown')?.addEventListener('click',()=>moveRelative(1));
    rich.addEventListener('dragstart',event=>{
      const marker=event.target.closest?.('span[data-photo-id]');
      if(!marker)return;
      draggingId=marker.dataset.photoId;
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain','LIBER-PHOTO:'+draggingId);
      marker.classList.add('is-dragging');
    });
    rich.addEventListener('dragover',event=>{
      if(draggingId){event.preventDefault();event.dataTransfer.dropEffect='move';}
    });
    rich.addEventListener('drop',event=>{
      if(!draggingId)return;
      event.preventDefault();
      const marker=Array.from(rich.querySelectorAll('span[data-photo-id]')).find(el=>el.dataset.photoId===draggingId);
      if(!marker)return;
      const dropRange=document.caretRangeFromPoint?.(event.clientX,event.clientY);
      if(!dropRange||!rich.contains(dropRange.commonAncestorContainer)||marker.contains(dropRange.commonAncestorContainer))return;
      dropRange.collapse(true);
      dropRange.insertNode(marker);
      showPanel(marker);
      draggingId=null;
    });
    rich.addEventListener('dragend',()=>{
      draggingId=null;
      rich.querySelectorAll('.is-dragging').forEach(el=>el.classList.remove('is-dragging'));
    });
    return {
      removeById(id){
        rich.querySelectorAll('span[data-photo-id]').forEach(el=>{if(el.dataset.photoId===String(id))el.remove();});
        if(selected?.dataset.photoId===String(id))showPanel(null);
      }
    };
  }
  window.LIBERInlinePhotos={cleanMarker,ids,hydrate,setupEditor};
})();