# 부록 A. WeddingAgreementMVP

## A-1. Owner 및 관리자 접근 제어

배포 주소를 `owner`로 지정하며 `onlyOwner`가 업체 승인, 거절, 자격 정지 작업을 제한한다.

## A-2. 업체 등록 구조

`VendorApplication`은 업체 지갑, 카테고리, metadata URI, 상태, 신청·심사 시각을 저장한다. `requestVendorRegistration`은 최초 신청과 Rejected 상태의 재신청을 허용한다.

## A-3. 업체 승인 / 거절

`approveVendor`와 `rejectVendor`는 Pending 신청을 각각 Verified와 Rejected로 확정한다.

## A-4. 업체 자격 정지

`revokeVendor`는 Verified 업체를 Suspended로 변경한다. 정지 업체는 신규 계약 생성과 변경안 제안이 불가능하지만 기존 Active 계약은 취소되지 않는다.

## A-5. Agreement 데이터 구조

`Agreement`는 buyer/vendor, `activeVersion`, `latestVersion`, 계약 상태와 생성 시각을 기록한다. 활성 버전과 최신 제안 버전을 분리해 미승인 변경안이 기존 계약에 영향을 주지 않게 한다.

## A-6. AgreementVersion 데이터 구조

`AgreementVersion`은 `documentHash`, `amountKRW`, 양측 승인 여부, 버전 상태, 최종 처리자·처리 시각과 생성 시각을 버전별로 보존한다.

## A-7. 최초 계약 V1 생성

Verified 업체만 `createAgreement`를 호출할 수 있다. 생성된 V1은 Pending이며 양측 승인 전 `activeVersion`은 0이다.

## A-8. 변경 계약 V2 이상 생성

Verified 계약 업체가 `proposeAgreementVersion`으로 Active 계약의 다음 버전을 제안한다. 새 버전은 Pending이고 기존 `activeVersion`은 유지된다.

## A-9. buyer/vendor 양측 승인

`approveAgreementVersion`은 최신 Pending 버전만 승인한다. buyer와 vendor 모두 승인하면 해당 버전이 Active가 되고 `activeVersion`이 갱신된다.

## A-10. 변경 계약 거절

계약 당사자는 `rejectAgreementVersion`으로 최신 대기 버전을 Rejected 처리한다. V2 이상 거절 시 Agreement는 Active로 복귀하며 직전 활성 버전을 유지한다.

## A-11. 변경 계약 철회

계약 업체는 `cancelPendingAgreementVersion`으로 최신 제안을 Cancelled 처리한다. V2 이상 철회 시에도 직전 활성 버전은 유지된다.

## A-12. 기존 Active 계약 유지 로직

변경 제안은 `latestVersion`만 증가시킨다. 승인 완료 전에는 `activeVersion`을 바꾸지 않으며, 거절·철회 시 Agreement 상태만 Active로 되돌린다.

## A-13. 조회 함수

`getVendorApplication`, `isVerifiedVendor`, `getAgreement`, `getAgreementVersion`, `getBuyerAgreementIds`, `getVendorAgreementIds`, `getAgreementCount`로 업체·계약·버전 정보를 조회한다.

## A-14. Kaia Kairos Testnet 테스트 결과

`WeddingAgreementMVP`는 Kaia Kairos Testnet의 `0xF397f508D109491b5B61d24C1095EC29c9f0AfCE`에 배포되었다. V1 활성화, 변경안 거절·철회 후 V1 유지, 업체 정지와 정지 업체의 생성·제안 차단 시나리오가 PASS로 기록되었다. 상세 결과는 [contract-test-results.md](contract-test-results.md)를 참고한다.

계약서 원문과 개인정보는 온체인에 저장하지 않는다. 온체인에는 검증에 필요한 문서 해시, 금액, 버전, 승인 상태와 타임스탬프만 기록한다.
