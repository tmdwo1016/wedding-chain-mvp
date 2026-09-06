This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Wedding Chain MVP 실행 및 검증

현재 구조는 `contracts/WeddingMarketMVP.sol`과 `frontend/app/`입니다.
`src/app/`은 사용하지 않습니다. Next.js 16, TypeScript, Tailwind CSS와 ethers.js 6을 사용합니다.
루트 `package.json`에는 ethers 의존성만 있고, 웹 실행 명령은 `frontend/package.json`에 있습니다.
스마트컨트랙트는 업체 등록, 상품·가격 이력, 예약 요청·승인·완료 기능을 제공하며 결제는 포함하지 않습니다.
현재 화면은 MetaMask 연결, 소비자의 Product #1 조회·예약 요청과 업체의 예약 목록·승인을 구현합니다.

프로젝트 루트에서 실행합니다. 의존성이 이미 설치되어 있다면 `npm ci`는 생략할 수 있습니다.

```bash
cd frontend
npm ci
npm run dev
```

터미널에 표시되는 주소(기본값 `http://localhost:3000`)를 MetaMask 확장 프로그램이 활성화된 브라우저에서 엽니다.
현재 구현은 `window.ethereum`에 주입된 MetaMask를 사용합니다. 다른 지갑 확장 프로그램과 충돌하면 해당 확장을 비활성화한 뒤 새로고침합니다.

### 네트워크와 컨트랙트

- 네트워크: Kaia Kairos Testnet
- Chain ID: `1001` (`0x3e9`)
- RPC: `https://public-en-kairos.node.kaia.io`
- 통화 기호: `KAIA`
- 블록 탐색기: `https://kairos.kaiascan.io`
- 컨트랙트: `0xFE8ADdfb365bc0CD0e4f054F679e1720b4b23f20`

[Kaia 공식 네트워크 정보](https://docs.kaia.io/references/public-en/)

### 정상 동작 테스트

1. **MetaMask 지갑 연결**을 클릭하고 MetaMask에서 계정 접근을 승인합니다.
2. MetaMask에서 Kaia Kairos Testnet을 선택합니다. 화면에 `Kaia Kairos Testnet (Chain ID: 1001)`과 연결 주소가 표시되는지 확인합니다. 등록된 업체가 아닌 계정에는 **소비자 예약**, 등록된 업체 계정에는 **업체 예약 관리**가 자동 표시됩니다.
3. **Studio 상품 불러오기**를 클릭합니다. 화면에서 `getProduct(1)`의 실제 응답을 확인합니다.

2026-09-06 공개 RPC 조회 결과:

| 항목 | 확인한 값 |
| --- | --- |
| 상품 | Studio Basic |
| 가격 | 900,000원 |
| 업체 지갑 | `0xcC5A6829B50DF6dC5266d76f43cc35B73138aC0F` |
| 판매 상태 | 판매 중 (active: true) |

이 값들은 화면에 하드코딩하지 않습니다. 상품 변경 후 다시 조회하면 최신 응답을 표시합니다.
가격은 원화 정수이며 KAIA 단위 변환을 하지 않습니다. `bigint`로 천 단위 구분을 적용해 정밀도를 유지합니다.
조회는 signer 없이 `BrowserProvider`로 수행하는 `view` 호출이므로 트랜잭션 서명이나 가스비가 필요하지 않습니다.
Secret Recovery Phrase, private key, GitHub PAT 또는 `.env` 설정은 필요하지 않습니다.

### 예약 테스트

1. 상품 vendor와 다른 **소비자 계정**을 MetaMask에 연결합니다. 이 계정에는 가스비를 낼 테스트 KAIA가 필요합니다.
2. Kairos에서 상품을 조회한 뒤 **예약하기**를 누릅니다. 이 단계에서는 트랜잭션을 보내지 않습니다.
3. 확인 화면에서 상품·가격·소비자·업체·컨트랙트 주소와 Chain ID 1001을 확인합니다. **취소**는 MetaMask 요청 없이 확인 화면을 닫습니다.
4. **확인하고 MetaMask에서 예약 승인**을 누릅니다. 앱이 계정·체인·최신 상품 상태를 재검사한 뒤 `createBooking(1)`을 호출합니다. MetaMask에서 가스비와 트랜잭션을 확인하고 승인합니다.
5. 전송 후 Transaction hash가 표시됩니다. Kairos RPC로 영수증을 확인하고, 성공한 영수증의 해당 컨트랙트 `BookingCreated` 이벤트에서 소비자·업체·Product ID를 대조해 Booking ID와 실제 기록된 예약 가격을 표시합니다.
6. 상태는 `Requested (업체 승인 대기)`입니다. 이 작업은 `acceptBooking`이나 `completeBooking`을 실행하지 않습니다.

상품 대금은 결제하지 않으며 트랜잭션 가스비만 발생합니다. 컨트랙트는 `createBooking` 실행 시점의 가격을 저장하므로, 확인 화면 이후 업체가 가격을 바꾸면 실제 기록된 가격이 달라질 수 있습니다. 프론트엔드의 전송 전 재검사만으로 이 차이를 완전히 막을 수 없으며, 성공 화면은 이벤트에 기록된 실제 예약 가격을 표시합니다.

- 등록된 업체 계정에는 소비자의 상품 조회·예약 버튼 대신 업체 예약 관리 화면이 표시됩니다. 소비자 화면의 inactive 상품에는 예약 버튼이 비활성화됩니다.
- MetaMask 승인을 거절하면 오류 안내 후 다시 시도할 수 있습니다.
- 가스비 부족 또는 컨트랙트 조건 위반 시 오류 안내가 표시됩니다.
- 계정·네트워크를 바꾸면 예약 확인 화면을 닫고 상품을 다시 조회하도록 합니다. 이미 전송한 거래의 해시와 결과는 원래 소비자 주소와 함께 유지합니다.
- 전송 및 결과 확인 중에는 중복 예약을 막습니다. 성공 후에도 현재 화면에서 추가 예약을 막습니다.
- 60초 내 영수증을 확인하지 못하거나 RPC가 실패하면 **예약 결과 다시 확인**으로 같은 해시를 조회합니다. 이것은 새 예약을 보내지 않습니다. 실패가 확정되기 전에는 새 예약을 차단합니다.
- MetaMask에서 거래를 가속하거나 취소해 다른 해시로 대체한 경우, 원래 해시만으로 결과를 확인하지 못할 수 있습니다. MetaMask 활동 내역과 탐색기에서 대체 거래를 확인합니다.
- 결과는 현재 페이지 메모리에 저장됩니다. 새로고침 전에 해시를 보관하고, 전송 여부가 불확실할 때는 재예약 전에 MetaMask와 탐색기를 확인합니다.

### 업체 화면과 예약 승인 테스트

계정 역할은 `getVendor(연결 주소)`로 조회합니다. 등록된 업체는 예약이 없어도 업체 화면으로 이동하며, 업체 등록이 없다는 `Vendor not found` 응답을 받은 계정은 소비자 화면으로 이동합니다. RPC 오류는 소비자 계정으로 처리하지 않고 재시도 안내를 표시합니다. 상품 판매자 주소를 하드코딩해 역할을 정하지 않습니다.

1. 소비자 계정으로 새 예약을 만듭니다. 기존 예약을 승인하려면 해당 예약이 `Requested`인지 확인합니다.
2. MetaMask에서 해당 상품의 **업체 계정**으로 전환합니다. 계정 변경을 감지하면 이전 상품·목록·확인 화면을 지우고 업체 화면을 자동으로 불러옵니다.
3. `getVendorBookingIds(업체 주소)`와 `getBooking(예약 ID)`로 이 업체에 들어온 모든 예약을 조회합니다. 목록에는 Booking ID, Product ID, 소비자 주소, 예약 당시 가격, 요청 시각과 상태가 표시됩니다. 신규 예약은 **예약 목록 새로고침**으로 불러옵니다.
4. `Requested` 예약의 **예약 승인**을 누릅니다. 예약 ID·소비자·업체·금액·네트워크와 `Requested → Accepted` 변경을 확인합니다. **승인 취소**는 MetaMask 요청 없이 확인 화면을 닫습니다.
5. **확인하고 MetaMask에서 업체 승인**을 누릅니다. 앱이 계정·Chain ID 1001·예약 소유자·최신 상태를 다시 확인하고, 연결 업체 signer로 `acceptBooking(bookingId)`를 실행합니다. 테스트 KAIA 가스비와 요청을 MetaMask에서 확인하고 승인합니다.
6. 거래 해시가 즉시 표시됩니다. 성공한 영수증에서 해당 컨트랙트의 `BookingStatusChanged` 이벤트와 예약 ID, `Requested → Accepted` 전환을 확인한 뒤 목록을 다시 조회합니다. 승인된 예약에는 승인 버튼이 사라집니다.

`Accepted`, `Completed`, `Cancelled` 예약에는 승인 버튼이 없습니다. 등록된 업체의 검증 상태도 표시하며, 현재 컨트랙트의 `acceptBooking`은 검증 플래그와 관계없이 해당 예약 업체에게 기존 `Requested` 예약 승인을 허용합니다.

2026-09-06 기능 추가 중 공개 RPC로 확인한 업체 `0xcC5A6829B50DF6dC5266d76f43cc35B73138aC0F`의 예약은 Booking #1, Product #1, 900,000원, `Completed` 상태였습니다. 이 데이터는 코드에 고정하지 않습니다. 이 예약에 승인 버튼이 없는 것은 정상이며, 새 소비자 예약으로 승인 흐름을 테스트할 수 있습니다.

추가로 확인할 예외 상황:

- 업체 A에서 업체 B 또는 소비자로 전환하면 A의 예약 목록·승인 확인 화면이 남지 않습니다.
- 업체가 아닌 소비자에게는 예약 승인 버튼이 표시되지 않습니다.
- 예약이 없는 업체에는 빈 목록 안내가 표시됩니다.
- 확인 화면 이후 소비자가 취소했거나 이미 승인된 예약은 전송 전 재조회에서 차단됩니다.
- 서명 거절·가스비 부족·실행 실패 시 성공으로 표시하지 않습니다.
- 거래 전송 중에는 중복 클릭을 막습니다. 60초 안에 영수증을 확인하지 못하면 해시를 유지하고 **승인 결과 다시 확인**을 제공합니다. 이것은 새 승인 거래를 보내지 않습니다.
- 이미 전송한 소비자 예약·업체 승인 거래의 결과 영역은 계정 전환 후에도 원래 실행 주소와 함께 유지합니다. 역할별 작업 버튼과 구분되며, 결과 재조회는 읽기 전용입니다.
- MetaMask에서 거래를 가속·취소하여 다른 해시로 대체하거나 페이지를 새로고침한 경우에는 MetaMask 활동 내역과 탐색기에서 거래를 확인합니다.

### 예외 상황 테스트

- MetaMask가 없는 브라우저에서 연결 버튼을 누르면 설치·활성화 안내가 표시됩니다.
- 연결 승인을 거절하면 오류 안내가 표시되고 다시 연결할 수 있습니다.
- 연결 요청 처리 중에는 버튼이 비활성화됩니다. MetaMask에 이미 대기 중인 요청이 있다면 팝업 확인 안내가 표시됩니다.
- 다른 네트워크에서는 상품 조회 버튼이 비활성화됩니다. 조회 직전에도 Chain ID를 다시 확인합니다.
- 상품 표시 후 계정이나 네트워크를 변경하면 기존 상품 정보가 사라지고 주소·네트워크가 갱신됩니다. Kairos에서 다시 조회합니다.
- 상품 조회 중 네트워크·계정을 변경해도 이전 요청 결과가 화면에 다시 나타나지 않는지 확인합니다.
- MetaMask에서 사이트 연결을 해제하거나 지갑을 잠그면 연결 주소와 상품이 지워집니다.
- RPC 연결이 끊기거나 컨트랙트 조회가 실패하면 오류 안내가 표시되고 이전 상품은 남지 않습니다. 지갑 `disconnect` 발생 시 연결 복구 후 새로고침합니다.

검사 및 프로덕션 실행 명령(모두 `frontend`에서 실행):

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

빌드 시 기존 `next/font/google` 설정에 따라 Google Fonts에 접근할 수 있어야 합니다.
Turbopack이 실행 환경의 내부 포트 생성 제한으로 실패하면 설정 변경 없이 `npm run build -- --webpack`으로 빌드하거나 `npm run dev -- --webpack`으로 실행할 수 있습니다.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
