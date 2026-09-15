# Changelog

Wedding Chain의 주요 개발 단계와 최종 방향을 정리합니다.

## Final — Agreement lifecycle DApp

- v2 컨트랙트의 업체 자격 정지와 계약 버전 거절·철회 lifecycle 반영
- 프론트엔드 ABI와 Kaia Kairos 배포 주소를 최종 배포본으로 갱신
- `AgreementDApp`에서 업체 등록 요청과 관리자 승인·거절 UI 구현
- Verified Vendor의 V1 계약 생성 및 계약 원문 `keccak256` 해시 기록
- Buyer / Vendor 양측 승인과 활성 버전 전환 구현
- V2 이상 변경 제안, 기존 활성 버전 유지, 양측 재승인 lifecycle 구현
- Agreement ID 기반 계약 조회와 전체 버전별 금액·hash·승인·생성시각 표시
- `/`와 `/agreement`가 동일한 최종 Agreement DApp을 렌더링하도록 구성
- Vercel main URL을 최종 Agreement DApp으로 변경

## Phase 2 — WeddingAgreementMVP

- 웨딩 계약을 `Agreement`와 불변의 `AgreementVersion` 이력으로 모델링
- 계약 원문 대신 document hash를 On-chain에 저장
- `activeVersion`과 `latestVersion`을 분리해 미승인 변경안과 현재 유효 계약을 구분
- 소비자·업체 양측 승인 및 변경 버전 재동의 구조 추가
- 업체 등록 신청과 관리자 검증 상태 추가

## Phase 1 — WeddingMarketMVP

- 검증 업체의 상품 등록과 가격 변경 이력 구현
- 소비자 예약 요청, 업체 승인, 이용 완료 상태 검증 구현
- 초기 MVP 컨트랙트인 `contracts/WeddingMarketMVP.sol`은 최종 버전과의 비교 및 프로젝트 발전 과정 보존을 위해 유지
