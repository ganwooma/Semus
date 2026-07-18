# 세무 도우미

종이 세금계산서 사진을 OpenCV로 문서 보정한 뒤 Gemini API에서 구조화 JSON으로 추출하고, Playwright가 공개 모의 홈택스 화면에 입력하는 Electron 데모입니다.

## 처리 흐름

1. 사진 촬영 또는 사진 파일 선택
2. OpenCV.js: 문서 외곽선 검출, 원근 보정, 대비 증가, 이진화
3. Gemini API: 세금계산서 항목을 JSON으로 추출
4. 사용자가 결과를 확인·수정
5. Playwright가 `https://estamp-helper.lovable.app/`에 입력

인증서·로그인·발급 버튼은 사용하지 않습니다.

## Gemini API 키 설정

프로젝트 최상단의 `.env` 파일에 API 키를 입력하세요.

```dotenv
GEMINI_API_KEY=여기에_API_키
GEMINI_MODEL=gemini-3.1-flash-image
```

`.env`는 Git에 포함되지 않습니다. 촬영 이미지는 Gemini API로 전송되므로, 실제 운영 환경에서는 키 사용량 제한과 API 제한을 설정하세요.

## 실행

```powershell
pnpm install
pnpm exec playwright install chromium
pnpm start
```

## 검증

```powershell
pnpm test:flow
```

테스트는 공개 모의 홈택스의 입력칸만 검증하며 발급·저장·제출 버튼을 누르지 않습니다.
