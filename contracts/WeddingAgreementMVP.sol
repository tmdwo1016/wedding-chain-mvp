// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// WeddingAgreementMVP : Wedding Chain의 계약 관리 Smart Contract
// 계약이 변경될 때 기존 계약을 덮어쓰지 않고 버전별로 보존한다.
// 실제 계약서 원문에는 개인정보와 상세 조건이 포함될 수 있으므로 블록체인에 직접 저장하지 않고,
// 원문의 해시값과 금액, 버전, 승인/거절 상태, 생성 시각 등 검증에 필요한 정보만 저장한다.

/**
 * 전체 흐름
 * 1. 업체가 등록을 신청
 * 2. 관리자가 업체를 승인하거나 거절
 * 3. 필요하면 관리자가 검증된 업체의 자격을 정지(Suspended)
 * 4. 승인된 업체가 소비자와의 최초 계약 V1을 생성
 * 5. 소비자와 업체가 각각 V1을 승인
 * 6. 양측 승인이 완료되면 V1이 Active 상태
 * 7. 승인 전 V1을 당사자가 거절하거나 업체가 취소하면 계약은 Cancelled
 * 8. 계약 조건이 바뀌면 업체가 V2, V3 등 형태로 새 버전을 제안
 * 9. 새 버전이 승인되기 전까지 기존 Active 버전은 그대로 유지
 * 10. 새 버전이 거절/취소되면 기존 Active 버전으로 복귀
 * 11. 새 버전에 대해 양측 재승인이 완료되면 해당 버전이 새로운 Active 계약으로 업데이트
 */
contract WeddingAgreementMVP {

    // -------------------------------------------------------------------------
    // Owner : 플랫폼 관리자
    // -------------------------------------------------------------------------

    // 컨트랙트를 배포한 주소를 관리자로 사용
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // -------------------------------------------------------------------------
    // 업체 등록 및 검증
    // -------------------------------------------------------------------------

    enum Category {
        Studio,
        Dress,
        Makeup
    }

    /**
     * 업체 등록 상태
     * None      : 등록 신청 전
     * Pending   : 관리자 검토 대기
     * Verified  : 관리자 승인 완료
     * Rejected  : 관리자 거절
     * Suspended : 승인 후 관리자에 의해 자격 정지
     */
    enum VendorStatus {
        None,
        Pending,
        Verified,
        Rejected,
        Suspended
    }

    struct VendorApplication {
        address wallet;
        Category category;
        string metadataURI;
        VendorStatus status;
        uint256 requestedAt;
        uint256 reviewedAt;
        bool exists;
    }

    mapping(address => VendorApplication) private vendorApplications;

    event VendorRegistrationRequested(
        address indexed vendor,
        Category category,
        string metadataURI,
        uint256 requestedAt
    );

    event VendorApproved(
        address indexed vendor,
        uint256 reviewedAt
    );

    event VendorRejected(
        address indexed vendor,
        uint256 reviewedAt
    );

    event VendorRevoked(
        address indexed vendor,
        uint256 revokedAt
    );

    function requestVendorRegistration(
        Category category,
        string calldata metadataURI
    ) external {
        VendorApplication storage application = vendorApplications[msg.sender];

        // 최초 신청 또는 이전 신청이 거절된 업체만 재신청 가능
        require(
            application.status == VendorStatus.None ||
            application.status == VendorStatus.Rejected,
            "Registration unavailable"
        );

        require(bytes(metadataURI).length > 0, "Empty metadata URI");

        vendorApplications[msg.sender] = VendorApplication({
            wallet: msg.sender,
            category: category,
            metadataURI: metadataURI,
            status: VendorStatus.Pending,
            requestedAt: block.timestamp,
            reviewedAt: 0,
            exists: true
        });

        emit VendorRegistrationRequested(
            msg.sender,
            category,
            metadataURI,
            block.timestamp
        );
    }

    function approveVendor(
        address vendorWallet
    ) external onlyOwner {
        VendorApplication storage application = vendorApplications[vendorWallet];

        require(application.exists, "Application not found");
        require(application.status == VendorStatus.Pending, "Not pending");

        application.status = VendorStatus.Verified;
        application.reviewedAt = block.timestamp;

        emit VendorApproved(vendorWallet, block.timestamp);
    }

    function rejectVendor(
        address vendorWallet
    ) external onlyOwner {
        VendorApplication storage application = vendorApplications[vendorWallet];

        require(application.exists, "Application not found");
        require(application.status == VendorStatus.Pending, "Not pending");

        application.status = VendorStatus.Rejected;
        application.reviewedAt = block.timestamp;

        emit VendorRejected(vendorWallet, block.timestamp);
    }

    /**
     * 검증 완료된 업체의 자격을 정지한다.
     * 기존 Active 계약을 자동 취소하지는 않지만,
     * 이후 신규 계약 생성 및 변경 계약 제안은 차단된다.
     */
    function revokeVendor(
        address vendorWallet
    ) external onlyOwner {
        VendorApplication storage application = vendorApplications[vendorWallet];

        require(application.exists, "Application not found");
        require(application.status == VendorStatus.Verified, "Vendor not verified");

        application.status = VendorStatus.Suspended;
        application.reviewedAt = block.timestamp;

        emit VendorRevoked(vendorWallet, block.timestamp);
    }

    function getVendorApplication(
        address vendorWallet
    )
        external
        view
        returns (VendorApplication memory)
    {
        require(vendorApplications[vendorWallet].exists, "Application not found");
        return vendorApplications[vendorWallet];
    }

    function isVerifiedVendor(
        address vendorWallet
    )
        public
        view
        returns (bool)
    {
        return vendorApplications[vendorWallet].status == VendorStatus.Verified;
    }

    // -------------------------------------------------------------------------
    // 계약 데이터 구조
    // -------------------------------------------------------------------------

    enum AgreementStatus {
        None,               // 0 : 존재하지 않는 계약
        PendingApproval,    // 1 : 최초 V1 승인 대기
        Active,             // 2 : 현재 효력이 있는 버전 존재
        ChangePending,      // 3 : 새 버전 승인 대기
        Cancelled           // 4 : 최초 계약이 거절/취소되어 종료
    }

    enum AgreementVersionStatus {
        None,       // 0 : 존재하지 않는 버전
        Pending,    // 1 : 승인 대기
        Active,     // 2 : 현재 또는 과거에 효력이 발생한 버전
        Rejected,   // 3 : 계약 당사자가 거절한 버전
        Cancelled   // 4 : 제안 업체가 철회한 버전
    }

    struct Agreement {
        uint256 id;
        address buyer;
        address vendor;
        uint256 activeVersion;
        uint256 latestVersion;
        AgreementStatus status;
        uint256 createdAt;
        bool exists;
    }

    struct AgreementVersion {
        uint256 version;
        bytes32 documentHash;
        uint256 amountKRW;

        bool buyerApproved;
        bool vendorApproved;

        AgreementVersionStatus status;
        address resolvedBy;      // 활성화/거절/취소를 최종 확정한 주소
        uint256 resolvedAt;      // 활성화/거절/취소 시각

        uint256 createdAt;
        bool exists;
    }

    uint256 private agreementCounter;

    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => mapping(uint256 => AgreementVersion)) private agreementVersions;

    mapping(address => uint256[]) private buyerAgreementIds;
    mapping(address => uint256[]) private vendorAgreementIds;

    // -------------------------------------------------------------------------
    // 계약 이벤트
    // -------------------------------------------------------------------------

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed buyer,
        address indexed vendor,
        uint256 version,
        bytes32 documentHash,
        uint256 amountKRW,
        uint256 createdAt
    );

    event AgreementVersionProposed(
        uint256 indexed agreementId,
        uint256 indexed previousActiveVersion,
        uint256 indexed newVersion,
        bytes32 documentHash,
        uint256 amountKRW,
        uint256 proposedAt
    );

    event AgreementVersionApproved(
        uint256 indexed agreementId,
        uint256 indexed version,
        address indexed approver,
        bool buyerApproved,
        bool vendorApproved,
        uint256 approvedAt
    );

    event AgreementActivated(
        uint256 indexed agreementId,
        uint256 indexed version,
        uint256 activatedAt
    );

    event AgreementVersionRejected(
        uint256 indexed agreementId,
        uint256 indexed version,
        address indexed rejectedBy,
        uint256 activeVersionAfterRejection,
        uint256 rejectedAt
    );

    event AgreementVersionCancelled(
        uint256 indexed agreementId,
        uint256 indexed version,
        address indexed cancelledBy,
        uint256 activeVersionAfterCancellation,
        uint256 cancelledAt
    );

    // -------------------------------------------------------------------------
    // 최초 계약(V1) 생성
    // -------------------------------------------------------------------------

    function createAgreement(
        address buyer,
        bytes32 documentHash,
        uint256 amountKRW
    )
        external
        returns (uint256)
    {
        require(isVerifiedVendor(msg.sender), "Not verified vendor");
        require(buyer != address(0), "Zero buyer address");
        require(buyer != msg.sender, "Vendor cannot be buyer");
        require(documentHash != bytes32(0), "Empty document hash");
        require(amountKRW > 0, "Amount must be positive");

        agreementCounter++;
        uint256 agreementId = agreementCounter;

        agreements[agreementId] = Agreement({
            id: agreementId,
            buyer: buyer,
            vendor: msg.sender,
            activeVersion: 0,
            latestVersion: 1,
            status: AgreementStatus.PendingApproval,
            createdAt: block.timestamp,
            exists: true
        });

        agreementVersions[agreementId][1] = AgreementVersion({
            version: 1,
            documentHash: documentHash,
            amountKRW: amountKRW,
            buyerApproved: false,
            vendorApproved: false,
            status: AgreementVersionStatus.Pending,
            resolvedBy: address(0),
            resolvedAt: 0,
            createdAt: block.timestamp,
            exists: true
        });

        buyerAgreementIds[buyer].push(agreementId);
        vendorAgreementIds[msg.sender].push(agreementId);

        emit AgreementCreated(
            agreementId,
            buyer,
            msg.sender,
            1,
            documentHash,
            amountKRW,
            block.timestamp
        );

        return agreementId;
    }

    // -------------------------------------------------------------------------
    // 변경 계약(V2 이상) 제안
    // -------------------------------------------------------------------------

    function proposeAgreementVersion(
        uint256 agreementId,
        bytes32 newDocumentHash,
        uint256 newAmountKRW
    )
        external
        returns (uint256)
    {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.exists, "Agreement not found");
        require(msg.sender == agreement.vendor, "Only agreement vendor");
        require(isVerifiedVendor(msg.sender), "Vendor not verified");
        require(agreement.status == AgreementStatus.Active, "Agreement not active");

        // 현재 승인 대기 중인 버전이 없는지 방어적으로 확인한다.
        AgreementVersion storage latestVersionData =
            agreementVersions[agreementId][agreement.latestVersion];
        require(
            latestVersionData.status != AgreementVersionStatus.Pending,
            "Pending version already exists"
        );

        require(newDocumentHash != bytes32(0), "Empty document hash");
        require(newAmountKRW > 0, "Amount must be positive");

        uint256 previousActiveVersion = agreement.activeVersion;
        uint256 newVersion = agreement.latestVersion + 1;

        agreementVersions[agreementId][newVersion] = AgreementVersion({
            version: newVersion,
            documentHash: newDocumentHash,
            amountKRW: newAmountKRW,
            buyerApproved: false,
            vendorApproved: false,
            status: AgreementVersionStatus.Pending,
            resolvedBy: address(0),
            resolvedAt: 0,
            createdAt: block.timestamp,
            exists: true
        });

        agreement.latestVersion = newVersion;
        agreement.status = AgreementStatus.ChangePending;

        emit AgreementVersionProposed(
            agreementId,
            previousActiveVersion,
            newVersion,
            newDocumentHash,
            newAmountKRW,
            block.timestamp
        );

        return newVersion;
    }

    // -------------------------------------------------------------------------
    // 계약 승인 / 거절 / 취소
    // -------------------------------------------------------------------------

    function approveAgreementVersion(
        uint256 agreementId,
        uint256 version
    ) external {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.exists, "Agreement not found");

        AgreementVersion storage agreementVersion =
            agreementVersions[agreementId][version];

        require(agreementVersion.exists, "Version not found");
        require(
            msg.sender == agreement.buyer || msg.sender == agreement.vendor,
            "Not agreement party"
        );
        require(version == agreement.latestVersion, "Not latest version");
        require(
            agreement.status == AgreementStatus.PendingApproval ||
            agreement.status == AgreementStatus.ChangePending,
            "Agreement not awaiting approval"
        );
        require(
            agreementVersion.status == AgreementVersionStatus.Pending,
            "Version not pending"
        );

        if (msg.sender == agreement.buyer) {
            require(!agreementVersion.buyerApproved, "Buyer already approved");
            agreementVersion.buyerApproved = true;
        }

        if (msg.sender == agreement.vendor) {
            // 정지된 업체가 신규/변경 계약을 최종 승인하는 것을 방지한다.
            require(isVerifiedVendor(msg.sender), "Vendor not verified");
            require(!agreementVersion.vendorApproved, "Vendor already approved");
            agreementVersion.vendorApproved = true;
        }

        emit AgreementVersionApproved(
            agreementId,
            version,
            msg.sender,
            agreementVersion.buyerApproved,
            agreementVersion.vendorApproved,
            block.timestamp
        );

        if (
            agreementVersion.buyerApproved &&
            agreementVersion.vendorApproved
        ) {
            agreement.activeVersion = version;
            agreement.status = AgreementStatus.Active;

            agreementVersion.status = AgreementVersionStatus.Active;
            agreementVersion.resolvedBy = msg.sender;
            agreementVersion.resolvedAt = block.timestamp;

            emit AgreementActivated(
                agreementId,
                version,
                block.timestamp
            );
        }
    }

    /**
     * 소비자 또는 업체가 최신 승인 대기 버전을 거절한다.
     * - V1 거절: Agreement 자체를 Cancelled 상태로 종료
     * - V2 이상 거절: 기존 activeVersion은 그대로 유지하고 Agreement는 다시 Active
     */
    function rejectAgreementVersion(
        uint256 agreementId,
        uint256 version
    ) external {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.exists, "Agreement not found");
        require(
            msg.sender == agreement.buyer || msg.sender == agreement.vendor,
            "Not agreement party"
        );
        require(version == agreement.latestVersion, "Not latest version");
        require(
            agreement.status == AgreementStatus.PendingApproval ||
            agreement.status == AgreementStatus.ChangePending,
            "Agreement not awaiting decision"
        );

        AgreementVersion storage agreementVersion =
            agreementVersions[agreementId][version];

        require(agreementVersion.exists, "Version not found");
        require(
            agreementVersion.status == AgreementVersionStatus.Pending,
            "Version not pending"
        );

        agreementVersion.status = AgreementVersionStatus.Rejected;
        agreementVersion.resolvedBy = msg.sender;
        agreementVersion.resolvedAt = block.timestamp;

        if (agreement.activeVersion == 0) {
            // 최초 V1이 아직 한 번도 활성화되지 않은 상태에서 거절
            agreement.status = AgreementStatus.Cancelled;
        } else {
            // 변경 버전 거절: 기존 Active 계약은 그대로 유지
            agreement.status = AgreementStatus.Active;
        }

        emit AgreementVersionRejected(
            agreementId,
            version,
            msg.sender,
            agreement.activeVersion,
            block.timestamp
        );
    }

    /**
     * 계약을 제안한 업체가 최신 승인 대기 버전을 철회한다.
     * - V1 취소: Agreement 자체를 Cancelled 상태로 종료
     * - V2 이상 취소: 기존 activeVersion은 그대로 유지하고 Agreement는 다시 Active
     */
    function cancelPendingAgreementVersion(
        uint256 agreementId,
        uint256 version
    ) external {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.exists, "Agreement not found");
        require(msg.sender == agreement.vendor, "Only agreement vendor");
        require(version == agreement.latestVersion, "Not latest version");
        require(
            agreement.status == AgreementStatus.PendingApproval ||
            agreement.status == AgreementStatus.ChangePending,
            "Agreement not awaiting decision"
        );

        AgreementVersion storage agreementVersion =
            agreementVersions[agreementId][version];

        require(agreementVersion.exists, "Version not found");
        require(
            agreementVersion.status == AgreementVersionStatus.Pending,
            "Version not pending"
        );

        agreementVersion.status = AgreementVersionStatus.Cancelled;
        agreementVersion.resolvedBy = msg.sender;
        agreementVersion.resolvedAt = block.timestamp;

        if (agreement.activeVersion == 0) {
            agreement.status = AgreementStatus.Cancelled;
        } else {
            agreement.status = AgreementStatus.Active;
        }

        emit AgreementVersionCancelled(
            agreementId,
            version,
            msg.sender,
            agreement.activeVersion,
            block.timestamp
        );
    }

    // -------------------------------------------------------------------------
    // 조회 함수
    // -------------------------------------------------------------------------

    function getAgreement(
        uint256 agreementId
    )
        external
        view
        returns (Agreement memory)
    {
        require(agreements[agreementId].exists, "Agreement not found");
        return agreements[agreementId];
    }

    function getAgreementVersion(
        uint256 agreementId,
        uint256 version
    )
        external
        view
        returns (AgreementVersion memory)
    {
        require(
            agreementVersions[agreementId][version].exists,
            "Version not found"
        );
        return agreementVersions[agreementId][version];
    }

    function getBuyerAgreementIds(
        address buyer
    )
        external
        view
        returns (uint256[] memory)
    {
        return buyerAgreementIds[buyer];
    }

    function getVendorAgreementIds(
        address vendor
    )
        external
        view
        returns (uint256[] memory)
    {
        return vendorAgreementIds[vendor];
    }

    function getAgreementCount()
        external
        view
        returns (uint256)
    {
        return agreementCounter;
    }
}
