// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WeddingMarketMVP
 * @notice 스드메(스튜디오/드레스/메이크업) 업체의 가격 공개와 예약 이력을
 *         블록체인에 남기는 교육용 MVP 스마트컨트랙트입니다.
 *
 * 핵심 기능
 * 1) 플랫폼 관리자가 검증된 업체 지갑을 등록
 * 2) 검증된 업체가 상품/옵션과 가격(KRW)을 등록
 * 3) 가격 변경 시 변경 이력을 온체인에 기록
 * 4) 소비자가 특정 상품을 예약
 * 5) 업체가 예약 승인, 소비자가 이용 완료 확인
 *
 * 주의
 * - 이 버전은 결제(Escrow)를 포함하지 않습니다.
 * - 실서비스에서는 업체 설명/사진/개인정보 등은 Off-chain DB에 저장하고,
 *   블록체인에는 검증이 필요한 최소 정보와 해시를 저장하는 것을 권장합니다.
 */
contract WeddingMarketMVP {
    address public owner;

    enum Category {
        Studio,
        Dress,
        Makeup
    }

    enum BookingStatus {
        Requested,
        Accepted,
        Completed,
        Cancelled
    }

    struct Vendor {
        address wallet;
        Category category;
        string metadataURI; // 상세 업체정보는 Off-chain에 두고 URI/식별자만 저장
        bool verified;
        bool exists;
    }

    struct Product {
        uint256 id;
        address vendor;
        string name;        // MVP 편의를 위해 온체인 저장
        string metadataURI; // 상세 설명/사진 등의 Off-chain 위치
        uint256 priceKRW;   // 원화 표시용 정수 (예: 800000)
        bool active;
        uint256 createdAt;
        bool exists;
    }

    struct PriceChange {
        uint256 oldPriceKRW;
        uint256 newPriceKRW;
        uint256 changedAt;
    }

    struct Booking {
        uint256 id;
        address buyer;
        address vendor;
        uint256 productId;
        uint256 bookedPriceKRW; // 예약 시점 가격을 고정 기록
        BookingStatus status;
        uint256 createdAt;
        bool exists;
    }

    uint256 private productCounter;
    uint256 private bookingCounter;

    mapping(address => Vendor) private vendors;
    mapping(uint256 => Product) private products;
    mapping(uint256 => Booking) private bookings;

    mapping(uint256 => PriceChange[]) private priceHistory;
    mapping(address => uint256[]) private vendorProductIds;
    mapping(address => uint256[]) private buyerBookingIds;
    mapping(address => uint256[]) private vendorBookingIds;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event VendorRegistered(
        address indexed vendor,
        Category category,
        string metadataURI
    );

    event VendorVerificationChanged(
        address indexed vendor,
        bool verified
    );

    event ProductRegistered(
        uint256 indexed productId,
        address indexed vendor,
        string name,
        uint256 priceKRW
    );

    event ProductPriceUpdated(
        uint256 indexed productId,
        address indexed vendor,
        uint256 oldPriceKRW,
        uint256 newPriceKRW,
        uint256 changedAt
    );

    event ProductActiveChanged(
        uint256 indexed productId,
        bool active
    );

    event BookingCreated(
        uint256 indexed bookingId,
        address indexed buyer,
        address indexed vendor,
        uint256 productId,
        uint256 bookedPriceKRW
    );

    event BookingStatusChanged(
        uint256 indexed bookingId,
        BookingStatus previousStatus,
        BookingStatus newStatus,
        uint256 changedAt
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyVerifiedVendor() {
        require(
            vendors[msg.sender].exists && vendors[msg.sender].verified,
            "Not verified vendor"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ---------------------------------------------------------------------
    // Admin / Vendor
    // ---------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /**
     * @notice 허위 업체 등록 방지를 위해 관리자(플랫폼)가 검증 후 업체를 등록합니다.
     * @dev 거래 가격 결정/예약 이행에는 관리자가 개입하지 않지만,
     *      업체 진위 검증을 위한 최소 관리 권한은 유지합니다.
     */
    function registerVendor(
        address vendorWallet,
        Category category,
        string calldata metadataURI
    ) external onlyOwner {
        require(vendorWallet != address(0), "Zero address");
        require(!vendors[vendorWallet].exists, "Vendor already exists");

        vendors[vendorWallet] = Vendor({
            wallet: vendorWallet,
            category: category,
            metadataURI: metadataURI,
            verified: true,
            exists: true
        });

        emit VendorRegistered(vendorWallet, category, metadataURI);
    }

    function setVendorVerified(
        address vendorWallet,
        bool verified
    ) external onlyOwner {
        require(vendors[vendorWallet].exists, "Vendor not found");
        vendors[vendorWallet].verified = verified;
        emit VendorVerificationChanged(vendorWallet, verified);
    }

    function getVendor(address vendorWallet)
        external
        view
        returns (Vendor memory)
    {
        require(vendors[vendorWallet].exists, "Vendor not found");
        return vendors[vendorWallet];
    }

    // ---------------------------------------------------------------------
    // Product / Price transparency
    // ---------------------------------------------------------------------

    function addProduct(
        string calldata name,
        string calldata metadataURI,
        uint256 priceKRW
    ) external onlyVerifiedVendor returns (uint256) {
        require(bytes(name).length > 0, "Empty name");
        require(priceKRW > 0, "Price must be positive");

        productCounter++;
        uint256 productId = productCounter;

        products[productId] = Product({
            id: productId,
            vendor: msg.sender,
            name: name,
            metadataURI: metadataURI,
            priceKRW: priceKRW,
            active: true,
            createdAt: block.timestamp,
            exists: true
        });

        vendorProductIds[msg.sender].push(productId);

        emit ProductRegistered(productId, msg.sender, name, priceKRW);

        return productId;
    }

    function updateProductPrice(
        uint256 productId,
        uint256 newPriceKRW
    ) external onlyVerifiedVendor {
        Product storage product = products[productId];

        require(product.exists, "Product not found");
        require(product.vendor == msg.sender, "Not product vendor");
        require(newPriceKRW > 0, "Price must be positive");
        require(newPriceKRW != product.priceKRW, "Same price");

        uint256 oldPrice = product.priceKRW;

        priceHistory[productId].push(
            PriceChange({
                oldPriceKRW: oldPrice,
                newPriceKRW: newPriceKRW,
                changedAt: block.timestamp
            })
        );

        product.priceKRW = newPriceKRW;

        emit ProductPriceUpdated(
            productId,
            msg.sender,
            oldPrice,
            newPriceKRW,
            block.timestamp
        );
    }

    function setProductActive(
        uint256 productId,
        bool active
    ) external onlyVerifiedVendor {
        Product storage product = products[productId];

        require(product.exists, "Product not found");
        require(product.vendor == msg.sender, "Not product vendor");

        product.active = active;
        emit ProductActiveChanged(productId, active);
    }

    function getProduct(uint256 productId)
        external
        view
        returns (Product memory)
    {
        require(products[productId].exists, "Product not found");
        return products[productId];
    }

    function getPriceHistory(uint256 productId)
        external
        view
        returns (PriceChange[] memory)
    {
        require(products[productId].exists, "Product not found");
        return priceHistory[productId];
    }

    function getVendorProductIds(address vendorWallet)
        external
        view
        returns (uint256[] memory)
    {
        return vendorProductIds[vendorWallet];
    }

    function getProductCount() external view returns (uint256) {
        return productCounter;
    }

    // ---------------------------------------------------------------------
    // Booking
    // ---------------------------------------------------------------------

    function createBooking(
        uint256 productId
    ) external returns (uint256) {
        Product memory product = products[productId];

        require(product.exists, "Product not found");
        require(product.active, "Inactive product");
        require(vendors[product.vendor].verified, "Vendor not verified");
        require(msg.sender != product.vendor, "Vendor cannot self-book");

        bookingCounter++;
        uint256 bookingId = bookingCounter;

        bookings[bookingId] = Booking({
            id: bookingId,
            buyer: msg.sender,
            vendor: product.vendor,
            productId: productId,
            bookedPriceKRW: product.priceKRW,
            status: BookingStatus.Requested,
            createdAt: block.timestamp,
            exists: true
        });

        buyerBookingIds[msg.sender].push(bookingId);
        vendorBookingIds[product.vendor].push(bookingId);

        emit BookingCreated(
            bookingId,
            msg.sender,
            product.vendor,
            productId,
            product.priceKRW
        );

        return bookingId;
    }

    /**
     * @notice 예약 업체만 요청을 승인할 수 있습니다.
     */
    function acceptBooking(uint256 bookingId) external {
        Booking storage booking = bookings[bookingId];

        require(booking.exists, "Booking not found");
        require(msg.sender == booking.vendor, "Only booking vendor");
        require(
            booking.status == BookingStatus.Requested,
            "Not requested status"
        );

        _changeBookingStatus(booking, BookingStatus.Accepted);
    }

    /**
     * @notice 서비스 이용 완료는 소비자가 확인합니다.
     */
    function completeBooking(uint256 bookingId) external {
        Booking storage booking = bookings[bookingId];

        require(booking.exists, "Booking not found");
        require(msg.sender == booking.buyer, "Only buyer");
        require(
            booking.status == BookingStatus.Accepted,
            "Not accepted status"
        );

        _changeBookingStatus(booking, BookingStatus.Completed);
    }

    /**
     * @notice 단순 MVP 버전이므로 결제가 없고,
     *         Requested/Accepted 단계에서 구매자 또는 업체가 취소할 수 있습니다.
     */
    function cancelBooking(uint256 bookingId) external {
        Booking storage booking = bookings[bookingId];

        require(booking.exists, "Booking not found");
        require(
            msg.sender == booking.buyer || msg.sender == booking.vendor,
            "Not booking party"
        );
        require(
            booking.status == BookingStatus.Requested ||
            booking.status == BookingStatus.Accepted,
            "Cannot cancel"
        );

        _changeBookingStatus(booking, BookingStatus.Cancelled);
    }

    function _changeBookingStatus(
        Booking storage booking,
        BookingStatus newStatus
    ) internal {
        BookingStatus previousStatus = booking.status;
        booking.status = newStatus;

        emit BookingStatusChanged(
            booking.id,
            previousStatus,
            newStatus,
            block.timestamp
        );
    }

    function getBooking(uint256 bookingId)
        external
        view
        returns (Booking memory)
    {
        require(bookings[bookingId].exists, "Booking not found");
        return bookings[bookingId];
    }

    function getBuyerBookingIds(address buyer)
        external
        view
        returns (uint256[] memory)
    {
        return buyerBookingIds[buyer];
    }

    function getVendorBookingIds(address vendorWallet)
        external
        view
        returns (uint256[] memory)
    {
        return vendorBookingIds[vendorWallet];
    }

    function getBookingCount() external view returns (uint256) {
        return bookingCounter;
    }
}
