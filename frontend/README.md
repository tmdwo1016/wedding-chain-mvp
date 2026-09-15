# Wedding Chain Frontend

최종 `WeddingAgreementMVP` 컨트랙트와 연동하는 Next.js DApp입니다. 루트 경로 `/`와 `/agreement`는 모두 `components/AgreementDApp.tsx`를 렌더링합니다.

## Run

```bash
npm install
npm run dev
```

기본 개발 주소는 [http://localhost:3000](http://localhost:3000)입니다. MetaMask가 필요하며, 앱에서 Kaia Kairos Testnet으로 전환할 수 있습니다.

검증 명령:

```bash
npm run build
npm run lint
```

## Network and Contract

- Network: Kaia Kairos Testnet
- Chain ID: `1001` (`0x3e9`)
- RPC: `https://public-en-kairos.node.kaia.io`
- Explorer: [https://kairos.kaiascan.io](https://kairos.kaiascan.io)
- Contract: `WeddingAgreementMVP`
- Address: [`0xF397f508D109491b5B61d24C1095EC29c9f0AfCE`](https://kairos.kaiascan.io/address/0xF397f508D109491b5B61d24C1095EC29c9f0AfCE)

## Implemented Flow

1. MetaMask 연결 및 Kairos 네트워크 확인
2. 업체 등록 요청
3. 관리자의 업체 승인 또는 거절
4. 관리자의 Verified 업체 자격 정지
5. Verified Vendor의 V1 계약 생성
6. Buyer와 Vendor의 최신 버전 승인
7. 양측 승인 완료 시 계약 활성화
8. Vendor의 V2 이상 변경 제안
9. 변경안 거절 또는 업체 철회 시 기존 Active 버전 유지
10. 변경 버전에 대한 양측 재승인 후 새 버전 활성화
11. Agreement ID로 계약과 전체 버전 이력 조회

계약 원문 입력은 브라우저에서 `keccak256` 해시로 변환되며, 컨트랙트에는 해시와 금액 등 검증 정보만 저장합니다. 원문 파일 업로드, 결제, Escrow, 환불과 개인정보 DB는 현재 범위에 포함되지 않습니다.

전체 프로젝트 설명과 설계는 저장소 루트의 [`README.md`](../README.md)를 참고하세요.
