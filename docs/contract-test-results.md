# WeddingAgreementMVP v2 테스트 결과

## Test Environment

| 항목 | 값 |
| --- | --- |
| Network | Kaia Kairos Testnet |
| Contract | `WeddingAgreementMVP` |
| Address | `0xF397f508D109491b5B61d24C1095EC29c9f0AfCE` |

아래는 해당 최종 배포본에 대해 완료된 테스트 결과 기록이다.

| Test | Scenario | Expected / Observed | Result |
| --- | --- | --- | --- |
| 1 | V1 생성 → vendor 승인 → buyer 승인 | V1 Active | PASS |
| 2 | V2 생성 → buyer 거절 | V2 Rejected, V1 Active 유지, `activeVersion = 1` | PASS |
| 3 | V3 생성 → vendor 철회 | V3 Cancelled, V1 Active 유지, `activeVersion = 1` | PASS |
| 4 | 관리자가 `revokeVendor` 실행 | VendorStatus가 Verified → Suspended | PASS |
| 5 | Suspended vendor가 `proposeAgreementVersion` 시도 | `"Vendor not verified"`로 revert | PASS |
| 6 | Suspended vendor가 `createAgreement` 시도 | `"Not verified vendor"`로 revert | PASS |

이 문서는 제공된 테스트넷 실행 결과를 정리한 것이며, 이번 저장소 갱신 과정에서 위 온체인 트랜잭션을 재실행한 기록은 아니다.
