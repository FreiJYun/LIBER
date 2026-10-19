/* LIBER Google Drive originals backup. No OAuth secret or token persistence. */
(()=>{
'use strict';
const clientId='857420802341-15m70e5gb2fs6l0ab5dord54is0h3a88.apps.googleusercontent.com';
const scope='https://www.googleapis.com/auth/drive.file';
const api='https://www.googleapis.com/drive/v3/files';
const uploads='https://www.googleapis.com/upload/drive/v3/files';
const rootName='LIBER - 원본 사진 백업';
let accessToken='',expiresAt=0,tokenClient=null,folderRoot=null;
const prefKey='liber_google_backup_enabled_v1';
function enabled(){try{return localStorage.getItem(prefKey)==='yes';}catch{return false;}}
function preference(value){try{localStorage.setItem(prefKey,value?'yes':'no');}catch{}}
function connected(){return !!accessToken&&Date.now()<expiresAt-60000;}
function authorized(){if(!window.LIBERCloud?.isAdmin())throw Error('LIBER 관리자 인증이 필요합니다.');}
function status(){return connected()?'connected':enabled()?'reconnect-needed':'disconnected';}
function connect(){
 authorized();
 if(connected())return Promise.resolve(true);
 if(!window.google?.accounts?.oauth2?.initTokenClient)
  return Promise.reject(Error('Google 인증 라이브러리를 불러오지 못했습니다. 광고 차단기 또는 인터넷 연결을 확인해 주세요.'));
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error,result)=>{
   if(settled)return;
   settled=true;
   clearTimeout(timeoutId);
   if(error)reject(error);else resolve(result);
  };
  const timeoutId=setTimeout(()=>finish(Error('Google 인증 시간이 초과됐습니다. 다시 연결해 주세요.')),120000);
  // New client per attempt prevents stale callbacks after a cancelled login.
  tokenClient=window.google.accounts.oauth2.initTokenClient({
   client_id:clientId,scope,
   callback(response){
    if(response?.error||!response?.access_token){
     finish(Error('Google 로그인 또는 권한 요청이 취소됐습니다. '+(response?.error_description||response?.error||'')));
     return;
    }
    if(response.scope&&!response.scope.split(' ').includes(scope)){
     finish(Error('Google Drive 파일 권한이 승인되지 않았습니다.'));return;
    }
    accessToken=response.access_token;
    expiresAt=Date.now()+Math.max(0,Number(response.expires_in)||3600)*1000;
    folderRoot=null;
    preference(true);
    finish(null,true);
   },
   error_callback(error){
    finish(Error(error?.type==='popup_closed'?'Google 계정 선택 창이 닫혔습니다.':'Google 인증 창을 열 수 없습니다. 팝업 차단을 확인해 주세요.'));
   }
  });
  try{tokenClient.requestAccessToken({prompt:'consent'});}
  catch(err){finish(err);}
 });
}
function disconnect(){
 const former=accessToken;
 accessToken='';expiresAt=0;folderRoot=null;tokenClient=null;preference(false);
 // Revoke consent when possible; token always discarded locally.
 if(former&&window.google?.accounts?.oauth2?.revoke){
  try{window.google.accounts.oauth2.revoke(former,()=>{});}catch(err){console.warn('Google authorization revocation:',err);}
 }
}
async function request(url,options={}){
 authorized();
 if(!connected())throw Error('Google Drive 연결이 만료됐습니다. 설정에서 다시 연결해 주세요.');
 const headers=new Headers(options.headers||{});
 headers.set('Authorization','Bearer '+accessToken);
 const response=await fetch(url,{...options,headers});
 if(!response.ok){
  let detail='';
  try{const body=await response.json();detail=body?.error?.message||body?.error_description||'';}catch{}
  if(response.status===401){accessToken='';expiresAt=0;}
  throw Error('Google Drive 요청 실패 ('+response.status+'): '+(detail||response.statusText));
 }
 if(response.status===204)return {};
 return response.json();
}
function queryPart(value){return String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
async function findNamedFile(parent,name,mime){
 const condition="'"+queryPart(parent)+"' in parents and name = '"+queryPart(name)+"' and trashed = false"+(mime?" and mimeType = '"+queryPart(mime)+"'":"");
 const params=new URLSearchParams({q:condition,fields:'nextPageToken,files(id,name,mimeType,webViewLink)',pageSize:'100',spaces:'drive'});
 const data=await request(api+'?'+params);
 return data.files?.[0]||null;
}
async function folder(parent,name){
 const mime='application/vnd.google-apps.folder';
 const existing=await findNamedFile(parent,name,mime);
 if(existing)return existing.id;
 const row=await request(api+'?fields=id,name',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({name,mimeType:mime,parents:[parent],description:'LIBER 블로그에서 생성한 원본 미디어 백업 폴더'})
 });
 if(!row.id)throw Error('Google Drive 백업 폴더 생성 결과에 ID가 없습니다.');
 return row.id;
}
async function postFolder(post){
 if(!folderRoot)folderRoot=await folder('root',rootName);
 const postId=String(post.id||'').replace(/[^a-zA-Z0-9_-]/g,'_');
 if(!postId)throw Error('게시글 ID가 없어 원본 백업 경로를 만들지 못했습니다.');
 return folder(folderRoot,'post-'+postId);
}
function filename(photo){
 const safe=String(photo.name||'original.jpg').replace(/[\\/:*?"<>|]/g,'_').slice(0,170);
 return String(photo.id).replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+safe;
}
async function uploadOriginal(parent,photo){
 const name=filename(photo),file=photo.blob;
 if(!(file instanceof Blob))throw Error('「'+name+'」의 원본 파일이 브라우저에 없습니다.');
 const mime=file.type||photo.type||'application/octet-stream';
 const metadata={name,mimeType:mime,parents:[parent],description:'LIBER original image backup',appProperties:{liberMediaId:String(photo.id)}};
 const existing=await findNamedFile(parent,name,null);
 if(existing)return {id:existing.id,skipped:true,name};
 let result;
 if(file.size<=5*1024*1024){
  const boundary='liber_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  const body=new Blob([
   '--'+boundary+'\r\n','Content-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),
   '\r\n--'+boundary+'\r\n','Content-Type: '+mime+'\r\n\r\n',file,
   '\r\n--'+boundary+'--\r\n'
  ]);
  result=await request(uploads+'?uploadType=multipart&fields=id,name,webViewLink',{
   method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body
  });
 }else{
  const init=await fetch(uploads+'?uploadType=resumable&fields=id,name,webViewLink',{
   method:'POST',
   headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(file.size)},
   body:JSON.stringify(metadata)
  });
  if(!init.ok){
   let detail='';try{detail=(await init.json())?.error?.message||'';}catch{}
   throw Error('Google Drive 대용량 업로드 준비 실패 ('+init.status+'): '+detail);
  }
  const target=init.headers.get('Location');
  if(!target||!target.startsWith('https://www.googleapis.com/'))throw Error('Google Drive가 안전한 업로드 URL을 반환하지 않았습니다.');
  // Use the resumable upload session URL issued by Google.
  result=await request(target,{method:'PUT',headers:{'Content-Type':mime},body:file});
 }
 if(!result?.id)throw Error('Google Drive가 업로드 완료 ID를 반환하지 않았습니다.');
 return {id:result.id,skipped:false,name};
}
async function backupOriginals(post,attachments,onProgress=()=>{}){
 authorized();
 if(!connected())throw Error('Google Drive 연결이 필요합니다. 설정에서 계정을 연결해 주세요.');
 const photos=(attachments||[]).filter(p=>p?.blob&&String(p.type||'').startsWith('image/'));
 if(!photos.length)return {total:0,uploaded:0,skipped:0};
 onProgress('Google Drive에 원본 백업 폴더 확인 중...');
 const parent=await postFolder(post);
 let uploaded=0,skipped=0;
 for(const [index,p] of photos.entries()){
  onProgress('Google Drive 원본 백업 '+(index+1)+'/'+photos.length+': '+String(p.name||'사진'));
  const result=await uploadOriginal(parent,p);
  if(result.skipped)skipped++;else uploaded++;
 }
 onProgress('Google Drive에 사진 원본 '+photos.length+'개 백업 완료');
 return {total:photos.length,uploaded,skipped,folderUrl:'https://drive.google.com/drive/folders/'+parent};
}
window.LIBERDrive={connected,enabled,status,connect,disconnect,backupOriginals};
})();