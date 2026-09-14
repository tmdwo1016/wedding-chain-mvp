// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WeddingAgreementMVP
 * @notice Wedding Chain 계약 생애주기 관리 MVP
 *
 * 구현 범위
 * 1. 업체 등록 신청
 * 2. 관리자 승인 / 거절
 * 3. 계약 V1 생성
 * 4. 계약 원문 Hash 온체인 기록
 * 5. 소비자 / 업체 양측 승인
 * 6. 계약 V2, V3 ... 변경 제안
 * 7. 기존 버전을 덮어쓰지 않고 보존
 * 8. 변경 버전 역시 양측 재동의 후 활성화
 */
contract WeddingAgreementMVP {

    // =========================================================
    // Owner
    // =========================================================

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // =========================================================
    // Vendor
    // =========================================================

    enum Category {
        Studio,
        Dress,
        Makeup
    }

    enum VendorStatus {
        None,
        Pending,
        Verified,
        Rejected
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

    /**
     * 0 = Studio
     * 1 = Dress
     * 2 = Makeup
     */
    function requestVendorRegistration(
        Category category,
        string calldata metadataURI
    ) external {

        VendorApplication storage application =
            vendorApplications[msg.sender];

        require(
            application.status == VendorStatus.None ||
            application.status == VendorStatus.Rejected,
            "Already requested or verified"
        );

        require(
            bytes(metadataURI).length > 0,
            "Empty metadata URI"
        );

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

        VendorApplication storage application =
            vendorApplications[vendorWallet];

        require(
            application.exists,
            "Application not found"
        );

        require(
            application.status == VendorStatus.Pending,
            "Not pending"
        );

        application.status = VendorStatus.Verified;
        application.reviewedAt = block.timestamp;

        emit VendorApproved(
            vendorWallet,
            block.timestamp
        );
    }

    function rejectVendor(
        address vendorWallet
    ) external onlyOwner {

        VendorApplication storage application =
            vendorApplications[vendorWallet];

        require(
            application.exists,
            "Application not found"
        );

        require(
            application.status == VendorStatus.Pending,
            "Not pending"
        );

        application.status = VendorStatus.Rejected;
        application.reviewedAt = block.timestamp;

        emit VendorRejected(
            vendorWallet,
            block.timestamp
        );
    }

    function getVendorApplication(
        address vendorWallet
    )
        external
        view
        returns (VendorApplication memory)
    {
        require(
            vendorApplications[vendorWallet].exists,
            "Application not found"
        );

        return vendorApplications[vendorWallet];
    }

    function isVerifiedVendor(
        address vendorWallet
    )
        public
        view
        returns (bool)
    {
        return
            vendorApplications[vendorWallet].status
            == VendorStatus.Verified;
    }

    // =========================================================
    // Agreement
    // =========================================================

    enum AgreementStatus {
        None,               // 0
        PendingApproval,    // 1
        Active,             // 2
        ChangePending,      // 3
        Cancelled           // 4
    }

    struct Agreement {
        uint256 id;
        address buyer;
        address vendor;

        // 현재 실제 효력이 있는 계약 버전
        uint256 activeVersion;

        // 가장 최근 생성된 버전
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

        uint256 createdAt;
        bool exists;
    }

    uint256 private agreementCounter;

    mapping(uint256 => Agreement) private agreements;

    mapping(uint256 => mapping(uint256 => AgreementVersion))
        private agreementVersions;

    mapping(address => uint256[]) private buyerAgreementIds;
    mapping(address => uint256[]) private vendorAgreementIds;

    // =========================================================
    // Agreement Events
    // =========================================================

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
        uint256 indexed previousVersion,
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

    // =========================================================
    // Agreement V1
    // =========================================================

    /**
     * @notice 검증된 업체가 최초 계약 V1을 생성한다.
     *
     * 실제 계약서 원문은 Off-chain에 저장하고
     * Hash만 On-chain에 저장한다.
     */
    function createAgreement(
        address buyer,
        bytes32 documentHash,
        uint256 amountKRW
    )
        external
        returns (uint256)
    {
        require(
            isVerifiedVendor(msg.sender),
            "Not verified vendor"
        );

        require(
            buyer != address(0),
            "Zero buyer address"
        );

        require(
            buyer != msg.sender,
            "Vendor cannot be buyer"
        );

        require(
            documentHash != bytes32(0),
            "Empty document hash"
        );

        require(
            amountKRW > 0,
            "Amount must be positive"
        );

        agreementCounter++;

        uint256 agreementId = agreementCounter;

        agreements[agreementId] = Agreement({
            id: agreementId,
            buyer: buyer,
            vendor: msg.sender,

            // 아직 양측 승인이 끝나지 않았으므로 0
            activeVersion: 0,

            // V1은 생성된 상태
            latestVersion: 1,

            status: AgreementStatus.PendingApproval,
            createdAt: block.timestamp,
            exists: true
        });

        agreementVersions[agreementId][1] =
            AgreementVersion({
                version: 1,
                documentHash: documentHash,
                amountKRW: amountKRW,
                buyerApproved: false,
                vendorApproved: false,
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

    // =========================================================
    // Agreement New Version
    // =========================================================

    /**
     * @notice 업체가 현재 활성 계약을 수정하여
     *         새로운 계약 버전을 제안한다.
     *
     * 기존 버전을 수정하지 않고 새로운 Version을 만든다.
     *
     * 예:
     * V1 = 3,800,000원
     * V2 = 4,100,000원
     */
    function proposeAgreementVersion(
        uint256 agreementId,
        bytes32 newDocumentHash,
        uint256 newAmountKRW
    )
        external
        returns (uint256)
    {
        Agreement storage agreement =
            agreements[agreementId];

        require(
            agreement.exists,
            "Agreement not found"
        );

        require(
            msg.sender == agreement.vendor,
            "Only agreement vendor"
        );

        require(
            isVerifiedVendor(msg.sender),
            "Vendor not verified"
        );

        require(
            agreement.status == AgreementStatus.Active,
            "Agreement not active"
        );

        // 이전에 제안된 미승인 버전이 없어야 함
        require(
            agreement.latestVersion == agreement.activeVersion,
            "Pending version already exists"
        );

        require(
            newDocumentHash != bytes32(0),
            "Empty document hash"
        );

        require(
            newAmountKRW > 0,
            "Amount must be positive"
        );

        uint256 previousVersion =
            agreement.activeVersion;

        uint256 newVersion =
            agreement.latestVersion + 1;

        agreementVersions[agreementId][newVersion] =
            AgreementVersion({
                version: newVersion,
                documentHash: newDocumentHash,
                amountKRW: newAmountKRW,

                // 계약이 변경되었으므로 다시 양측 승인 필요
                buyerApproved: false,
                vendorApproved: false,

                createdAt: block.timestamp,
                exists: true
            });

        agreement.latestVersion = newVersion;
        agreement.status = AgreementStatus.ChangePending;

        emit AgreementVersionProposed(
            agreementId,
            previousVersion,
            newVersion,
            newDocumentHash,
            newAmountKRW,
            block.timestamp
        );

        return newVersion;
    }

    // =========================================================
    // Agreement Approval
    // =========================================================

    /**
     * @notice 소비자 또는 업체가 최신 계약 버전을 승인한다.
     */
    function approveAgreementVersion(
        uint256 agreementId,
        uint256 version
    ) external {

        Agreement storage agreement =
            agreements[agreementId];

        require(
            agreement.exists,
            "Agreement not found"
        );

        AgreementVersion storage agreementVersion =
            agreementVersions[agreementId][version];

        require(
            agreementVersion.exists,
            "Version not found"
        );

        require(
            msg.sender == agreement.buyer ||
            msg.sender == agreement.vendor,
            "Not agreement party"
        );

        // 과거 버전을 다시 승인하는 것을 막음
        require(
            version == agreement.latestVersion,
            "Not latest version"
        );

        require(
            agreement.status == AgreementStatus.PendingApproval ||
            agreement.status == AgreementStatus.ChangePending,
            "Agreement not awaiting approval"
        );

        if (msg.sender == agreement.buyer) {

            require(
                !agreementVersion.buyerApproved,
                "Buyer already approved"
            );

            agreementVersion.buyerApproved = true;
        }

        if (msg.sender == agreement.vendor) {

            require(
                !agreementVersion.vendorApproved,
                "Vendor already approved"
            );

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

        // 양측 승인 완료
        if (
            agreementVersion.buyerApproved &&
            agreementVersion.vendorApproved
        ) {
            agreement.activeVersion = version;
            agreement.status = AgreementStatus.Active;

            emit AgreementActivated(
                agreementId,
                version,
                block.timestamp
            );
        }
    }

    // =========================================================
    // Agreement Read
    // =========================================================

    function getAgreement(
        uint256 agreementId
    )
        external
        view
        returns (Agreement memory)
    {
        require(
            agreements[agreementId].exists,
            "Agreement not found"
        );

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