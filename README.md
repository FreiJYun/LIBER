# LIBER — 개인 로마풍 블로그

공개 주소: https://freijyun.github.io/LIBER/

LIBER는 **GitHub Pages(화면) + Supabase(게시글·카테고리·이웃·설정·인증·공개용 미디어)** 구조의 개인 블로그입니다. 데이터베이스는 SmartPlayer와 분리된 LIBER 전용 프로젝트를 사용합니다.

## 현재 구조

| 항목 | 저장/운영 방식 |
| --- | --- |
| 홈페이지 코드 | GitHub Pages, 이 저장소 |
| 공개 글 / 비공개 초안 | Supabase PostgreSQL `public.liber_posts` |
| 카테고리 분류 트리 | `public.liber_categories` |
| 이웃 프로필 목록 | `public.liber_neighbors` |
| 공통 블로그 소개 | `public.liber_site_settings` |
| 관리자 승인 명부 | `public.liber_admins` |
| 관리자 로그인 | Supabase Auth 이메일 로그인 |
| 온라인 이미지·동영상 | Supabase Storage `liber-media` |
| 옛날 브라우저 글 / 개인 서체 | 해당 브라우저 IndexedDB에 보존 |
| 원본 사진의 장기 백업 | **Google Drive 100GB (아직 수동 백업 단계)** |

**주의:** 브라우저 코드에는 Supabase의 공개용 `publishable` 키만 있습니다. 비밀 키(`service_role`, secret key 등)는 절대 공개 저장소에 넣지 마세요. 실제 DB 편집은 Supabase의 Row Level Security(RLS)가 관리자 승인 명부를 조회해 판단합니다.

## 관리자 인증: 최초 1회 설정

1. Supabase 프로젝트에서 **Authentication → URL Configuration**을 여세요.
2. Site URL을 `https://freijyun.github.io/LIBER/`로 설정하고, Redirect URLs에 `https://freijyun.github.io/LIBER/**`를 추가하세요. 브라우저의 `#/admin` 경로로 돌아오는 이메일 인증 링크를 허용하려는 설정입니다.
3. 공개 LIBER에서 **`#/admin`** 페이지를 열고 본인의 이메일로 로그인 링크를 보내세요. 같은 브라우저에서 이메일 링크를 열어 로그인하세요.
4. 로그인 직후에는 권한이 **승인 대기**로 나타납니다. 화면에 자신의 Supabase User ID와 안전한 1회용 SQL 명령이 표시됩니다.
5. 본인이 직접 **Supabase SQL Editor**에서 안내된 SQL을 실행하거나, ChatGPT에 관리자 등록을 요청하세요. 타인의 User ID를 임의로 승인하지 마세요.
6. **관리자 권한 다시 확인**을 누르세요. 승인됐다면 글쓰기·카테고리·이웃 수정이 열립니다.

프로젝트: https://supabase.com/dashboard/project/muwvbthekagigehnywjx

인증만 된 일반 방문자는 관리자 명부에 속하지 않는 한 **절대 DB를 수정할 수 없습니다.** 승인되지 않은 사용자는 공개 글만 읽을 수 있습니다.

## 운영 시작

- 새로운 글: 관리자로 로그인 → **글쓰기** → 제목·카테고리·본문 작성 → 게시 또는 임시저장.
- 본문 사진: 커서 위치에서 **▧ 사진 삽입**, 크기·정렬·캡션 조정.
- 카테고리: **카테고리 관리**에서 상위/하위 분류·정렬을 관리. 변경 시 Supabase 동기화. 관리자의 브라우저에 기존 로컬 분류 초안이 있으면 확인 후 동기화하세요.
- 이웃: **이웃** 페이지에서 등록·수정·삭제. 관리자 변경은 Supabase에 동기화됩니다.
- 방문자: 관리자 로그인 없이 게시글 및 분류 목록을 읽습니다. **임시저장 글은 공개 목록에 나오지 않습니다.**

사진 업로드 시 큰 JPEG/PNG는 필요에 따라 WebP로 최적화하여 전송합니다. 파일당 업로드 제한은 50 MB입니다. **Supabase Free 파일 스토리지 1 GB는 조직 전체의 합산 한도**이므로, 원본 사진은 Google Drive 등에 별도 보관하세요. 스토리지가 공개 버킷인 만큼 임시저장 글의 미디어 URL을 외부에 공유하지 않는 것이 좋습니다. 완전한 비공개 미디어 보관은 추후 별도 private 버킷을 구성하는 것이 좋습니다.

## 기존 브라우저 글 이전

과거 LIBER의 글은 쓰던 브라우저의 IndexedDB에 그대로 남아 있습니다. **서버 이전이 자동으로 되거나 원본이 삭제되지 않습니다.**

1. 옛 글을 작성했던 **동일한 브라우저·프로필·주소**에서 LIBER에 접속하세요.
2. 관리자로 로그인한 뒤 **설정 → 이 브라우저의 옛 글 이전**을 실행하세요.
3. 옛 글을 서버에 **임시저장 상태로 복사**합니다. 중복된 글 ID는 건너뛰고, 원본은 그대로 보존됩니다.
4. 관리자 화면에서 글·사진·카테고리를 확인한 후 원하는 글만 공개 상태로 게시하세요.

## 백업 및 복원

- 관리자는 **설정 → 클라우드 백업**에서 글·첨부 미디어·분류·이웃을 JSON으로 내려받을 수 있습니다. 다수의 사진·동영상은 큰 파일을 만들 수 있습니다.
- **설정 → 백업 복원**은 파일을 서버로 되돌립니다. 동일한 글 ID가 있으면 덮어씁니다. 주의해서 사용하세요.
- Google Drive 백업 자동 전송, 자동 스냅샷, 도메인 인증은 아직 구현하지 않았습니다.
- 로컬 서체 파일은 브라우저에서 별도로 보관됩니다.

## 이전 버전에서 달라진 점

- 방문자별로 달랐던 IndexedDB 게시글이 이제 **공용 Supabase PostgreSQL**에서 제공됩니다.
- 기존 예시 글 3개는 새 방문자에게 자동 생성되지 않습니다.
- 홈페이지 디자인과 계층형 카테고리 사이드바, 로마풍 카드 썸네일, 본문 이미지 편집은 유지됩니다.
- `categories.json`·`neighbors.json`은 이전 버전의 참고·백업 파일입니다. 공개 사이트는 Supabase 데이터를 우선 사용합니다.
- 실제 관리자 로그인 승인이 완료되기 전에는 게시글을 수정할 수 없습니다.

## 구성 파일

- `index.html`, `styles.css`: 로마풍 레이아웃
- `app.js`: 홈페이지·게시글·글쓰기·백업
- `liber-cloud.js`: Supabase 읽기·쓰기·인증·미디어 업로드
- `categories.js`: 계층형 카테고리
- `neighbors.js`: 이웃 블로그
- `journal-sidebar.js`: 트리 탐색
- `inline-images.js`: 문단 중간 사진 삽입·편집

## 유의사항

- 사이트는 GitHub Pages에 호스팅되므로 HTTPS 및 브라우저 인터넷 연결이 필요합니다.
- Supabase Free 프로젝트는 유휴 상태에서 일시 중지될 수 있습니다.
- 타인에게 관리자 권한을 주지 않도록 Supabase Auth 계정과 SQL 변경 권한을 보호하세요.
- 최초 관리자 승인과 이메일 Redirect URL 설정 전에는 로그인/게시를 끝까지 확인할 수 없습니다.
