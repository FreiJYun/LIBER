/* LIBER cloud adapter. Only publishable key in browser; all writes enforced by Supabase RLS. */
(() => {
'use strict';
const url = 'https://muwvbthekagigehnywjx.supabase.co';
const publishableKey = "sb_publishable_YYy4Sn9oQIQ8Cc8ks91JEg_Z3EnDpKA";
const bucket = 'liber-media';
let client=null, user=null, admin=false, authError='';
const check=({data,error})=>{if(error)throw new Error(error.message||'Supabase 요청 실패');return data;};
async function init(){
 if(!window.supabase?.createClient)throw Error('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
 client=window.supabase.createClient(url,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
 const session=await client.auth.getSession();
 if(session.error)console.warn('Session restore:',session.error.message);
 user=session.data?.session?.user||null;
 await refreshAdmin();
 client.auth.onAuthStateChange((event,session)=>{user=session?.user||null;if(event==='SIGNED_OUT')admin=false;});
 return true;
}
async function refreshAdmin(){
 admin=false;
 if(!user||!client)return false;
 try{const result=await client.rpc('liber_is_admin');admin=!!check(result);}
 catch(e){authError=e.message;console.warn(e);}
 return admin;
}
function isAdmin(){return admin;}
function currentUser(){return user;}
function ready(){return !!client;}
function urlFor(path){
 if(!path)return '';
 const result=client.storage.from(bucket).getPublicUrl(path);
 return result.data?.publicUrl||'';
}
function mapAttachment(a){
 const item={id:String(a.id||''),name:String(a.name||''),type:String(a.type||''),storagePath:String(a.storagePath||'')};
 if(item.storagePath)item.remoteUrl=urlFor(item.storagePath);
 return item;
}
function mapPost(p){
 return {
   id:p.id,title:p.title,subtitle:p.subtitle||'',category:p.category||'기타',
   categoryId:p.category_id||'',tags:p.tags||[],body:p.body||'',links:p.links||[],
   published:p.published!==false,demo:p.demo===true,
   createdAt:Date.parse(p.created_at)||Date.now(),updatedAt:Date.parse(p.updated_at)||Date.now(),
   attachments:(Array.isArray(p.attachments)?p.attachments:[]).map(mapAttachment)
 };
}
async function posts(includeDrafts=true){
 if(!client)throw Error('Cloud not initialized');
 let query=client.from('liber_posts').select('*').order('created_at',{ascending:false}).limit(2000);
 if(!admin || !includeDrafts)query=query.eq('published',true);
 return check(await query).map(mapPost);
}
async function post(id){
 if(!client)throw Error('Cloud not initialized');
 const result=await client.from('liber_posts').select('*').eq('id',id).maybeSingle();
 return mapPostOrNull(check(result));
}
function mapPostOrNull(value){return value?mapPost(value):null;}
function ensureAdmin(){
 if(!admin)throw Error('관리자 권한이 없습니다. 관리자 로그인 후 다시 시도해 주세요.');
}
async function optimizeImage(blob){
 if(!blob?.type?.startsWith('image/')||blob.type==='image/gif'||blob.size<1200000)return blob;
 if(typeof createImageBitmap!=='function')return blob;
 try{
  const bitmap=await createImageBitmap(blob);
  const maxSize=2048;
  const scale=Math.min(1,maxSize/Math.max(bitmap.width,bitmap.height));
  if(scale===1 && blob.size<2500000){bitmap.close?.();return blob;}
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  bitmap.close?.();
  const compressed=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.84));
  if(compressed&&compressed.size<blob.size)return compressed;
  return blob;
 }catch(e){console.warn('Image conversion failed',e);return blob;}
}
async function ensurePostCategory(categoryId){
 if(!categoryId)return null;
 const id=String(categoryId);
 const existing=check(await client.from('liber_categories').select('id,kind').eq('id',id).maybeSingle());
 if(existing){
  if(existing.kind!=='posts')throw Error('선택한 카테고리가 게시글 분류가 아닙니다.');
  return id;
 }
 // Restore only the selected category and its ancestors from an earlier local draft.
 // Do not overwrite or delete other remote categories.
 const ancestry=window.LIBERCategories?.ancestry('posts',id)||[];
 if(!ancestry.length||ancestry[ancestry.length-1].id!==id)
  throw Error('선택한 카테고리가 서버에 없고 로컬에서도 찾을 수 없습니다. 카테고리를 다시 선택해 주세요.');
 for(const item of ancestry){
  const prior=check(await client.from('liber_categories').select('id,kind').eq('id',item.id).maybeSingle());
  if(prior){
   if(prior.kind!=='posts')throw Error('카테고리 ID가 다른 분류와 충돌합니다.');
   continue;
  }
  check(await client.from('liber_categories').insert({
   id:item.id,kind:'posts',name:String(item.name).slice(0,50),
   parent_id:item.parentId||null,sort_order:Number.isInteger(item.order)?item.order:0
  }));
 }
 return id;
}
async function savePost(p){
 ensureAdmin();
 const verifiedCategoryId=await ensurePostCategory(p.categoryId);
 const previous=check(await client.from('liber_posts').select('attachments').eq('id',String(p.id)).maybeSingle());
 const previousPaths=(Array.isArray(previous?.attachments)?previous.attachments:[]).map(a=>a.storagePath).filter(Boolean);
 const uploads=[];
 const attachments=[];
 try{
  for(const a of p.attachments||[]){
   if(a.storagePath){
    attachments.push({id:String(a.id),name:String(a.name||''),type:String(a.type||''),storagePath:String(a.storagePath)});
    continue;
   }
   if(!a.blob)continue;
   let blob=await optimizeImage(a.blob);
   if(blob.size>50*1024*1024)throw Error('파일당 업로드 제한은 50MB입니다. 큰 동영상은 외부 링크를 이용해 주세요.');
   const type=blob.type||a.type;
   const valid=['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'];
   if(!valid.includes(type))throw Error('업로드 형식을 지원하지 않습니다: '+type);
   const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'}[type];
   const postId=String(p.id).replace(/[^a-zA-Z0-9_-]/g,'_');
   const mediaId=String(a.id).replace(/[^a-zA-Z0-9_-]/g,'_');
   const storagePath='posts/'+postId+'/'+mediaId+'-'+Date.now()+'.'+extension;
   check(await client.storage.from(bucket).upload(storagePath,blob,{contentType:type,upsert:false,cacheControl:'3600'}));
   uploads.push(storagePath);
   attachments.push({id:String(a.id),name:String(a.name||'첨부파일').slice(0,200),type,storagePath});
  }
  const row={
   id:String(p.id),title:String(p.title).trim(),subtitle:String(p.subtitle||''),
   category_id:verifiedCategoryId,category:String(p.category||'기타'),
   tags:Array.isArray(p.tags)?p.tags:[],body:String(p.body||''),
   links:Array.isArray(p.links)?p.links:[],
   attachments,published:p.published!==false,demo:p.demo===true,
   created_at:new Date(p.createdAt||Date.now()).toISOString(),
   updated_at:new Date().toISOString()
  };
  check(await client.from('liber_posts').upsert(row,{onConflict:'id'}));
  const keep=new Set(attachments.map(x=>x.storagePath));
  const stale=previousPaths.filter(path=>!keep.has(path));
  if(stale.length)try{check(await client.storage.from(bucket).remove(stale));}catch(error){console.warn('Old media cleanup pending',error);}
  return mapPost({...row});
 }catch(err){
  if(uploads.length)await client.storage.from(bucket).remove(uploads).catch(()=>{});
  throw err;
 }
}
async function deletePost(id){
 ensureAdmin();
 const existing=check(await client.from('liber_posts').select('attachments').eq('id',id).maybeSingle());
 const paths=(Array.isArray(existing?.attachments)?existing.attachments:[]).map(a=>a.storagePath).filter(Boolean);
 // Delete the database row first to avoid leaving a visible post with broken images.
 check(await client.from('liber_posts').delete().eq('id',id));
 if(paths.length)try{check(await client.storage.from(bucket).remove(paths));}catch(error){console.warn('Media cleanup pending',error);}
}
async function listCategories(){
 const rows=check(await client.from('liber_categories').select('id,kind,name,parent_id,sort_order').order('sort_order',{ascending:true}).limit(1000));
 return {posts:rows.filter(x=>x.kind==='posts').map(x=>({id:x.id,name:x.name,parentId:x.parent_id,order:x.sort_order})),
 neighbors:rows.filter(x=>x.kind==='neighbors').map(x=>({id:x.id,name:x.name,parentId:x.parent_id,order:x.sort_order}))};
}
async function saveCategories(payload){
 ensureAdmin();
 // Parent-first upsert and child-first deletion; the UI enforces an acyclic tree.
 const all=[...(payload.posts||[]).map(x=>({...x,kind:'posts'})),...(payload.neighbors||[]).map(x=>({...x,kind:'neighbors'}))];
 const visited=new Set(),sorted=[];
 function walk(n){if(visited.has(n.id))return;visited.add(n.id);const parent=all.find(x=>x.id===n.parentId);if(parent)walk(parent);sorted.push(n);}
 all.forEach(walk);
 for(const item of sorted){
  check(await client.from('liber_categories').upsert({id:item.id,kind:item.kind,name:item.name,parent_id:item.parentId||null,sort_order:item.order||0},{onConflict:'id'}));
 }
 const remote=await listCategories();
 const keep=new Set(all.map(x=>x.id));
 const stale=[...remote.posts,...remote.neighbors].filter(x=>!keep.has(x.id));
 // Delete leaves first; dependents must be moved by UI before dropping a parent.
 while(stale.length){
  const leaf=stale.find(x=>!stale.some(y=>y.parentId===x.id));
  if(!leaf)throw Error('카테고리 순환 참조가 있습니다.');
  check(await client.from('liber_categories').delete().eq('id',leaf.id));
  stale.splice(stale.indexOf(leaf),1);
 }
 return true;
}
async function neighbors(){
 const rows=check(await client.from('liber_neighbors').select('*').order('sort_order',{ascending:true}).limit(600));
 return rows.map(x=>({id:x.id,name:x.name,url:x.url,avatar:x.avatar||'',description:x.description||'',categories:x.categories||[]}));
}
async function saveNeighbors(items){
 ensureAdmin();
 const old=check(await client.from('liber_neighbors').select('id'));
 const keep=new Set(items.map(x=>x.id));
 if(items.length){
  const rows=items.map((x,i)=>({id:x.id,name:x.name,url:x.url,avatar:x.avatar||'',description:x.description||'',categories:x.categories||[],sort_order:i}));
  check(await client.from('liber_neighbors').upsert(rows,{onConflict:'id'}));
 }
 for(const row of old)if(!keep.has(row.id))check(await client.from('liber_neighbors').delete().eq('id',row.id));
 return true;
}
async function siteIdentity(){
 const row=check(await client.from('liber_site_settings').select('value').eq('key','identity').maybeSingle());
 return row?.value||null;
}
async function saveSiteIdentity(value){
 ensureAdmin();
 check(await client.from('liber_site_settings').upsert({key:'identity',value,updated_at:new Date().toISOString()},{onConflict:'key'}));
}
async function sendLogin(email){
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||''))throw Error('올바른 이메일을 입력해 주세요.');
 const destination=location.origin+location.pathname+'#/admin';
 check(await client.auth.signInWithOtp({email,options:{emailRedirectTo:destination,shouldCreateUser:true}}));
}
async function signOut(){
 check(await client.auth.signOut());
 admin=false;user=null;
}
function managementUrl(){return 'https://supabase.com/dashboard/project/muwvbthekagigehnywjx';}
window.LIBERCloud={init,ready,urlFor,isAdmin,currentUser,refreshAdmin,posts,post,savePost,deletePost,listCategories,saveCategories,neighbors,saveNeighbors,siteIdentity,saveSiteIdentity,sendLogin,signOut,managementUrl};
})();
