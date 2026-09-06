"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract, Interface, JsonRpcProvider, isError } from "ethers";
import type { TransactionReceipt } from "ethers";

const KAIROS_CHAIN_ID = BigInt(1001);
const TARGET_BOOKING_ID = BigInt(2);
const KAIROS_RPC_URL = "https://public-en-kairos.node.kaia.io";
const CONTRACT_ADDRESS =
  "0xFE8ADdfb365bc0CD0e4f054F679e1720b4b23f20";

const CONTRACT_ABI = [
  "function getVendor(address vendorWallet) view returns (tuple(address wallet, uint8 category, string metadataURI, bool verified, bool exists))",
  "function getVendorBookingIds(address vendorWallet) view returns (uint256[])",
  "function getBooking(uint256 bookingId) view returns (tuple(uint256 id, address buyer, address vendor, uint256 productId, uint256 bookedPriceKRW, uint8 status, uint256 createdAt, bool exists))",
  "function acceptBooking(uint256 bookingId)",
  "function completeBooking(uint256 bookingId)",
  "event BookingStatusChanged(uint256 indexed bookingId, uint8 previousStatus, uint8 newStatus, uint256 changedAt)",
  "function createBooking(uint256 productId) returns (uint256)",
  "event BookingCreated(uint256 indexed bookingId, address indexed buyer, address indexed vendor, uint256 productId, uint256 bookedPriceKRW)",
  {
    inputs: [
      {
        internalType: "uint256",
        name: "productId",
        type: "uint256",
      },
    ],
    name: "getProduct",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "id", type: "uint256" },
          { internalType: "address", name: "vendor", type: "address" },
          { internalType: "string", name: "name", type: "string" },
          {
            internalType: "string",
            name: "metadataURI",
            type: "string",
          },
          {
            internalType: "uint256",
            name: "priceKRW",
            type: "uint256",
          },
          { internalType: "bool", name: "active", type: "bool" },
          {
            internalType: "uint256",
            name: "createdAt",
            type: "uint256",
          },
          { internalType: "bool", name: "exists", type: "bool" },
        ],
        internalType: "struct WeddingMarketMVP.Product",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

type ProductInfo = {
  id: string;
  vendor: string;
  name: string;
  metadataURI: string;
  priceKRW: string;
  active: boolean;
};

type BookingReview = { product: ProductInfo; buyer: string };
type AccountRole = {
  account: string;
  kind: "consumer" | "vendor" | "error";
  productVendor?: string;
  error?: string;
};
type VendorBooking = {
  id: string;
  buyer: string;
  vendor: string;
  productId: string;
  priceKRW: string;
  status: number;
  createdAt: string;
};
type AcceptTransaction = {
  hash: string;
  bookingId: string;
  vendor: string;
  status: "pending" | "success" | "failed" | "unconfirmed";
  message: string;
};
type CompleteTransaction = Omit<AcceptTransaction, "vendor"> & { buyer: string };
const BOOKING_STATUS_LABELS = [
  "Requested (0) · 승인 대기", "Accepted (1) · 승인 완료",
  "Completed (2) · 이용 완료", "Cancelled (3) · 취소됨",
];

function acceptanceFromReceipt(receipt: TransactionReceipt, transaction: AcceptTransaction): AcceptTransaction {
  if (receipt.status === 0) {
    return { ...transaction, status: "failed", message: "승인 트랜잭션이 실패했습니다. 예약 목록을 다시 확인해주세요." };
  }
  if (receipt.status !== 1) throw new Error("승인 결과를 아직 확인할 수 없습니다.");
  const contractInterface = new Interface(CONTRACT_ABI);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
    const event = contractInterface.parseLog(log);
    if (event?.name === "BookingStatusChanged"
      && event.args.bookingId.toString() === transaction.bookingId
      && event.args.previousStatus === BigInt(0)
      && event.args.newStatus === BigInt(1)) {
      return { ...transaction, status: "success", message: "예약을 승인했습니다. Accepted (1) 상태로 변경되었습니다." };
    }
  }
  throw new Error("승인 이벤트를 확인하지 못했습니다. 탐색기에서 거래 결과를 확인해주세요.");
}

function completionFromReceipt(receipt: TransactionReceipt, transaction: CompleteTransaction): CompleteTransaction {
  if (receipt.status === 0) {
    return { ...transaction, status: "failed", message: "이용 완료 트랜잭션이 실패했습니다. 예약 상태를 다시 확인해주세요." };
  }
  if (receipt.status !== 1) throw new Error("이용 완료 결과를 아직 확인할 수 없습니다.");
  const contractInterface = new Interface(CONTRACT_ABI);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
    const event = contractInterface.parseLog(log);
    if (event?.name === "BookingStatusChanged"
      && event.args.bookingId.toString() === transaction.bookingId
      && event.args.previousStatus === BigInt(1)
      && event.args.newStatus === BigInt(2)) {
      return { ...transaction, status: "success", message: "이용 완료가 등록되었습니다. status = Completed (2)" };
    }
  }
  throw new Error("이용 완료 이벤트를 확인하지 못했습니다. 탐색기에서 거래 결과를 확인해주세요.");
}

type BookingTransaction = {
  hash: string;
  buyer: string;
  vendor: string;
  status: "pending" | "success" | "failed" | "unconfirmed";
  message: string;
  bookingId?: string;
  priceKRW?: string;
};

function bookingFromReceipt(receipt: TransactionReceipt, transaction: BookingTransaction): BookingTransaction {
  if (receipt.status === 0) {
    return { ...transaction, status: "failed", message: "트랜잭션이 실패했습니다. 예약은 생성되지 않았습니다." };
  }
  if (receipt.status !== 1) throw new Error("트랜잭션 실행 결과를 아직 확인할 수 없습니다.");
  const contractInterface = new Interface(CONTRACT_ABI);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
    const event = contractInterface.parseLog(log);
    if (event?.name === "BookingCreated"
      && event.args.buyer.toLowerCase() === transaction.buyer.toLowerCase()
      && event.args.vendor.toLowerCase() === transaction.vendor.toLowerCase()
      && event.args.productId === BigInt(1)) {
      return {
        ...transaction,
        status: "success",
        message: "예약 요청이 등록되었습니다. 업체 승인을 기다려주세요.",
        bookingId: event.args.bookingId.toString(),
        priceKRW: event.args.bookedPriceKRW.toString(),
      };
    }
  }
  throw new Error("트랜잭션은 처리되었지만 BookingCreated 이벤트를 확인하지 못했습니다. 탐색기에서 확인해주세요.");
}

type WalletEvent = "accountsChanged" | "chainChanged" | "disconnect";
type WalletListener = (value: unknown) => void;
type MetaMaskProvider = {
  isMetaMask?: boolean;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: WalletEvent, listener: WalletListener): void;
  removeListener(event: WalletEvent, listener: WalletListener): void;
};

function getMetaMask(): MetaMaskProvider | undefined {
  const ethereum = (window as Window & { ethereum?: MetaMaskProvider }).ethereum;
  return ethereum?.isMetaMask ? ethereum : undefined;
}

function firstAccount(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}

function parseChainId(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("지갑의 Chain ID를 확인할 수 없습니다.");
  }
  return BigInt(value);
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const details = error as { code?: unknown; shortMessage?: unknown; message?: unknown };
    if (details.code === 4001 || details.code === "ACTION_REJECTED") {
      return "MetaMask 요청을 취소했습니다. 다시 시도할 수 있습니다.";
    }
    if (details.code === -32002) {
      return "MetaMask에 대기 중인 요청이 있습니다. 지갑 팝업을 확인해주세요.";
    }
    if (details.code === 4900 || details.code === 4901) {
      return "지갑의 네트워크 연결을 확인한 뒤 페이지를 새로고침해주세요.";
    }
    if (details.code === "CALL_EXCEPTION") {
      return "상품을 조회할 수 없습니다. 컨트랙트 주소와 상품 등록 상태를 확인해주세요.";
    }
    if (typeof details.shortMessage === "string") return details.shortMessage;
    if (typeof details.message === "string") return details.message;
  }
  return "알 수 없는 오류가 발생했습니다. 다시 시도해주세요.";
}

function bookingErrorMessage(error: unknown): string {
  if (isError(error, "INSUFFICIENT_FUNDS")) return "가스비를 낼 테스트 KAIA가 부족합니다.";
  if (isError(error, "CALL_EXCEPTION")) {
    switch (error.reason) {
      case "Vendor cannot self-book": return "업체는 자신의 상품을 예약할 수 없습니다. 소비자 계정으로 연결해주세요.";
      case "Inactive product": return "판매가 중지된 상품입니다. 상품을 다시 불러와주세요.";
      case "Vendor not verified": return "현재 검증되지 않은 업체이므로 예약할 수 없습니다.";
      case "Product not found": return "상품이 존재하지 않습니다.";
      case "Booking not found": return "예약이 존재하지 않습니다. 목록을 새로고침해주세요.";
      case "Only booking vendor": return "이 예약의 업체 계정만 승인할 수 있습니다.";
      case "Not requested status": return "이미 처리되거나 취소된 예약입니다. 목록을 새로고침해주세요.";
      case "Only buyer": return "이 예약의 소비자 계정만 이용 완료를 등록할 수 있습니다.";
      case "Not accepted status": return "Accepted (1) 예약만 이용 완료를 등록할 수 있습니다. 상태를 다시 확인해주세요.";
      default: return "예약을 실행할 수 없습니다. 상품 상태와 계정, 테스트 KAIA 잔액을 확인해주세요.";
    }
  }
  return errorMessage(error);
}

export default function Home() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [message, setMessage] = useState("");
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [bookingReview, setBookingReview] = useState<BookingReview | null>(null);
  const [bookingTransaction, setBookingTransaction] = useState<BookingTransaction | null>(null);
  const [bookingPhase, setBookingPhase] = useState<"" | "preparing" | "signing" | "pending">("");
  const [bookingError, setBookingError] = useState("");
  const [accountRole, setAccountRole] = useState<AccountRole | null>(null);
  const [roleRefresh, setRoleRefresh] = useState(0);
  const [vendorBookings, setVendorBookings] = useState<VendorBooking[] | null>(null);
  const [vendorListError, setVendorListError] = useState("");
  const [acceptTransaction, setAcceptTransaction] = useState<AcceptTransaction | null>(null);
  const [acceptPhase, setAcceptPhase] = useState<"" | "preparing" | "signing" | "pending">("");
  const [acceptError, setAcceptError] = useState("");
  const [buyerBooking, setBuyerBooking] = useState<VendorBooking | null>(null);
  const [buyerBookingError, setBuyerBookingError] = useState("");
  const [completeTransaction, setCompleteTransaction] = useState<CompleteTransaction | null>(null);
  const [completePhase, setCompletePhase] = useState<"" | "preparing" | "signing" | "pending">("");
  const [completeError, setCompleteError] = useState("");
  const busy = useRef(false);
  // 계정/체인 변경 전 시작한 요청이 오래된 결과를 표시하지 않도록 합니다.
  const walletVersion = useRef(0);
  const walletSyncRequest = useRef(0);
  const walletSnapshot = useRef<{ account: string; chainId: bigint | null }>({ account: "", chainId: null });
  const isKairos = chainId === KAIROS_CHAIN_ID;
  const isBusy = isConnecting || isLoading || bookingPhase !== "" || acceptPhase !== "" || completePhase !== "";
  const currentRole = isKairos && accountRole?.account === account ? accountRole : null;
  const isConsumer = currentRole?.kind === "consumer";
  const isVendor = currentRole?.kind === "vendor"
    && currentRole.productVendor?.toLowerCase() === account.toLowerCase();
  const bookingLocked = bookingTransaction !== null
    && bookingTransaction.buyer.toLowerCase() === account.toLowerCase()
    && bookingTransaction.status !== "failed";
  const acceptLocked = acceptTransaction?.status === "pending" || acceptTransaction?.status === "unconfirmed";
  const isProductVendor = !!product && account.toLowerCase() === product.vendor.toLowerCase();
  const isBookingBuyer = isKairos && !!buyerBooking
    && buyerBooking.buyer.toLowerCase() === account.toLowerCase();
  const completeLocked = completeTransaction?.status === "pending" || completeTransaction?.status === "unconfirmed";

  const refreshAccountView = useCallback(() => {
    setAccountRole(null);
    setVendorBookings(null);
    setVendorListError("");
    setAcceptError("");
    setBookingError("");
    setBuyerBooking(null);
    setBuyerBookingError("");
    setCompleteError("");
    setRoleRefresh((value) => value + 1);
  }, []);

  const applyWalletState = useCallback((nextAccount: string, nextChainId: bigint | null) => {
    const previous = walletSnapshot.current;
    if (previous.account !== nextAccount || previous.chainId !== nextChainId) {
      walletVersion.current += 1;
      walletSnapshot.current = { account: nextAccount, chainId: nextChainId };
      setProduct(null);
      setBookingReview(null);
      refreshAccountView();
    }
    setAccount(nextAccount);
    setChainId(nextChainId);
  }, [refreshAccountView]);

  const synchronizeWallet = useCallback(async (ethereum: MetaMaskProvider) => {
    const requestId = ++walletSyncRequest.current;
    const version = walletVersion.current;
    const isCurrent = () => requestId === walletSyncRequest.current
      && version === walletVersion.current && ethereum === getMetaMask();
    try {
      // UI는 ethers의 network 캐시나 ethereum.chainId 속성이 아닌 RPC 응답을 사용합니다.
      const [chain, accounts] = await Promise.all([
        ethereum.request({ method: "eth_chainId" }),
        ethereum.request({ method: "eth_accounts" }),
      ]);
      if (!isCurrent()) return null;
      const next = { account: firstAccount(accounts), chainId: parseChainId(chain) };
      applyWalletState(next.account, next.chainId);
      return next;
    } catch (error) {
      if (isCurrent()) {
        applyWalletState(walletSnapshot.current.account, null);
        setMessage(`MetaMask 네트워크 확인 실패: ${errorMessage(error)}`);
      }
      return null;
    }
  }, [applyWalletState]);

  useEffect(() => {
    if (!account || chainId !== KAIROS_CHAIN_ID) return;
    const ethereum = getMetaMask();
    if (!ethereum) return;
    const version = walletVersion.current;
    const provider = new BrowserProvider(ethereum, undefined, { cacheTimeout: -1 });
    let cancelled = false;
    let vendorFound = false;
    const isCurrent = () => !cancelled && version === walletVersion.current;
    const loadAccountView = async () => {
      try {
        if (parseChainId(await ethereum.request({ method: "eth_chainId" })) !== KAIROS_CHAIN_ID) {
          throw new Error("Kairos 네트워크에서 계정 유형을 확인해주세요.");
        }
        const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
        const productOne = await contract.getProduct(1);
        if (!isCurrent()) return;
        if (!productOne.exists || productOne.id !== BigInt(1)) {
          throw new Error("Product #1의 업체 정보를 확인할 수 없습니다.");
        }
        if (productOne.vendor.toLowerCase() !== account.toLowerCase()) {
          setAccountRole({ account, kind: "consumer", productVendor: productOne.vendor });
          return;
        }
        vendorFound = true;
        setAccountRole({ account, kind: "vendor", productVendor: productOne.vendor });
        const booking = await contract.getBooking(TARGET_BOOKING_ID);
        if (!isCurrent()) return;
        if (!booking.exists || booking.id !== TARGET_BOOKING_ID || booking.productId !== BigInt(1)
          || booking.vendor.toLowerCase() !== productOne.vendor.toLowerCase()) {
          throw new Error("Booking #2가 Product #1의 업체 예약과 일치하지 않습니다.");
        }
        setVendorBookings([{
          id: booking.id.toString(), buyer: booking.buyer, vendor: booking.vendor,
          productId: booking.productId.toString(), priceKRW: booking.bookedPriceKRW.toString(),
          status: Number(booking.status), createdAt: booking.createdAt.toString(),
        }]);
      } catch (error) {
        if (!isCurrent()) return;
        if (vendorFound) setVendorListError(`Booking #2 조회 실패: ${bookingErrorMessage(error)}`);
        else setAccountRole({ account, kind: "error", error: `계정 유형 조회 실패: ${errorMessage(error)}` });
      } finally {
        provider.destroy();
      }
    };
    void loadAccountView();
    return () => { cancelled = true; };
  }, [account, chainId, roleRefresh]);

  useEffect(() => {
    if (!account || chainId !== KAIROS_CHAIN_ID) return;
    const ethereum = getMetaMask();
    if (!ethereum) return;
    const version = walletVersion.current;
    const provider = new BrowserProvider(ethereum, undefined, { cacheTimeout: -1 });
    let cancelled = false;
    const isCurrent = () => !cancelled && version === walletVersion.current;
    const loadBuyerBooking = async () => {
      try {
        if (parseChainId(await ethereum.request({ method: "eth_chainId" })) !== KAIROS_CHAIN_ID) {
          throw new Error("Kairos 네트워크에서 예약을 확인해주세요.");
        }
        const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
        const booking = await contract.getBooking(TARGET_BOOKING_ID);
        if (!isCurrent()) return;
        if (!booking.exists || booking.id !== TARGET_BOOKING_ID) throw new Error("Booking #2가 존재하지 않습니다.");
        if (booking.buyer.toLowerCase() !== account.toLowerCase()) {
          setBuyerBooking(null);
          return;
        }
        setBuyerBooking({
          id: booking.id.toString(), buyer: booking.buyer, vendor: booking.vendor,
          productId: booking.productId.toString(), priceKRW: booking.bookedPriceKRW.toString(),
          status: Number(booking.status), createdAt: booking.createdAt.toString(),
        });
      } catch (error) {
        if (isCurrent()) {
          setBuyerBooking(null);
          setBuyerBookingError(`Booking #2 조회 실패: ${bookingErrorMessage(error)}`);
        }
      } finally {
        provider.destroy();
      }
    };
    void loadBuyerBooking();
    return () => { cancelled = true; };
  }, [account, chainId, roleRefresh]);

  useEffect(() => {
    let ethereum: MetaMaskProvider | undefined;

    const accountsChanged: WalletListener = (accounts) => {
      walletSyncRequest.current += 1;
      const nextAccount = firstAccount(accounts);
      // 계정 변경은 즉시 표시하고, 현재 체인도 직접 다시 확인합니다.
      applyWalletState(nextAccount, null);
      setMessage(nextAccount
        ? "연결 계정이 변경되었습니다. 계정에 맞는 화면을 불러옵니다."
        : "지갑 연결이 해제되었습니다. MetaMask를 다시 연결해주세요.");
      if (ethereum) void synchronizeWallet(ethereum);
    };
    const chainChanged: WalletListener = (value) => {
      walletSyncRequest.current += 1;
      try {
        const nextChainId = parseChainId(value);
        applyWalletState(walletSnapshot.current.account, nextChainId);
        setMessage(nextChainId === KAIROS_CHAIN_ID
          ? "Kaia Kairos Testnet입니다. 계정에 맞는 화면을 불러옵니다."
          : "MetaMask에서 Kaia Kairos Testnet(Chain ID: 1001)으로 변경해주세요.");
      } catch (error) {
        applyWalletState(walletSnapshot.current.account, null);
        setMessage(errorMessage(error));
      }
    };
    const disconnected: WalletListener = () => {
      walletSyncRequest.current += 1;
      applyWalletState("", null);
      setMessage("지갑의 네트워크 연결이 끊겼습니다. 연결을 확인한 뒤 새로고침해주세요.");
    };

    const removeWalletListeners = () => {
      ethereum?.removeListener("accountsChanged", accountsChanged);
      ethereum?.removeListener("chainChanged", chainChanged);
      ethereum?.removeListener("disconnect", disconnected);
    };
    const refreshWallet = () => {
      const current = getMetaMask();
      if (current !== ethereum) {
        removeWalletListeners();
        walletVersion.current += 1;
        walletSyncRequest.current += 1;
        ethereum = current;
        ethereum?.on("accountsChanged", accountsChanged);
        ethereum?.on("chainChanged", chainChanged);
        ethereum?.on("disconnect", disconnected);
      }
      if (ethereum) void synchronizeWallet(ethereum);
    };

    // 이미 연결된 지갑도 페이지 진입 즉시 읽습니다. 늦은 주입과 탭 복귀도 처리합니다.
    refreshWallet();
    window.addEventListener("ethereum#initialized", refreshWallet);
    window.addEventListener("focus", refreshWallet);
    return () => {
      walletVersion.current += 1;
      walletSyncRequest.current += 1;
      removeWalletListeners();
      window.removeEventListener("ethereum#initialized", refreshWallet);
      window.removeEventListener("focus", refreshWallet);
    };
  }, [applyWalletState, synchronizeWallet]);

  const connectWallet = async () => {
    if (busy.current) return;
    const ethereum = getMetaMask();
    if (!ethereum) {
      setMessage("MetaMask를 찾을 수 없습니다. 확장 프로그램을 설치하거나 활성화한 뒤 새로고침해주세요.");
      return;
    }
    busy.current = true;
    setIsConnecting(true);
    walletSyncRequest.current += 1;
    setProduct(null);
    setBookingReview(null);
    setMessage("");
    const version = walletVersion.current;
    try {
      await ethereum.request({ method: "eth_requestAccounts" });
      // 승인 이후 실제 주입된 MetaMask에서 새 RPC 요청으로 상태를 읽습니다.
      const current = getMetaMask();
      if (!current || current !== ethereum) throw new Error("지갑 provider가 변경되었습니다. 다시 연결해주세요.");
      const next = await synchronizeWallet(current);
      if (!next) return;
      if (!next.account) {
        setMessage("연결된 계정이 없습니다. MetaMask에서 계정 접근을 허용해주세요.");
        return;
      }
      setMessage(next.chainId === KAIROS_CHAIN_ID
        ? "지갑 연결이 완료되었습니다. 계정에 맞는 화면을 불러옵니다."
        : "MetaMask에서 Kaia Kairos Testnet(Chain ID: 1001)으로 변경해주세요.");
    } catch (error) {
      if (version === walletVersion.current) {
        setMessage(`지갑 연결 실패: ${errorMessage(error)}`);
      }
    } finally {
      busy.current = false;
      setIsConnecting(false);
    }
  };

  const loadProduct = async () => {
    if (busy.current || !isConsumer) return;
    const ethereum = getMetaMask();
    if (!ethereum) {
      setMessage("MetaMask가 필요합니다. 설치하거나 활성화한 뒤 새로고침해주세요.");
      return;
    }
    busy.current = true;
    setIsLoading(true);
    setProduct(null);
    setBookingReview(null);
    setMessage("");
    const version = walletVersion.current;
    let provider: BrowserProvider | undefined;
    try {
      const [accounts, chain] = await Promise.all([
        ethereum.request({ method: "eth_accounts" }),
        ethereum.request({ method: "eth_chainId" }),
      ]);
      if (version !== walletVersion.current) return;
      const nextAccount = firstAccount(accounts);
      const nextChainId = parseChainId(chain);
      applyWalletState(nextAccount, nextChainId);
      if (!nextAccount) throw new Error("먼저 MetaMask 지갑을 연결해주세요.");
      if (nextChainId !== KAIROS_CHAIN_ID) {
        throw new Error("MetaMask에서 Kaia Kairos Testnet(Chain ID: 1001)으로 변경해주세요.");
      }
      if (version !== walletVersion.current) return;

      // signer 없이 view 함수만 호출하므로 서명이나 가스비가 필요하지 않습니다.
      provider = new BrowserProvider(ethereum, undefined, { cacheTimeout: -1 });
      const currentChainId = parseChainId(await ethereum.request({ method: "eth_chainId" }));
      if (version !== walletVersion.current) return;
      if (currentChainId !== KAIROS_CHAIN_ID) {
        throw new Error("네트워크가 변경되었습니다. Kairos에서 다시 시도해주세요.");
      }
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const result = await contract.getProduct(1);
      const finalChainId = parseChainId(await ethereum.request({ method: "eth_chainId" }));
      if (version !== walletVersion.current) return;
      applyWalletState(walletSnapshot.current.account, finalChainId);
      if (finalChainId !== KAIROS_CHAIN_ID) {
        throw new Error("네트워크가 변경되었습니다. Kairos에서 다시 시도해주세요.");
      }
      if (!result.exists || result.id !== BigInt(1)) {
        throw new Error("Product #1이 등록되어 있지 않습니다.");
      }
      setProduct({
        id: result.id.toString(),
        vendor: result.vendor,
        name: result.name,
        metadataURI: result.metadataURI,
        priceKRW: result.priceKRW.toString(),
        active: result.active,
      });

      setMessage("상품 정보를 블록체인에서 불러왔습니다.");
    } catch (error) {
      if (version === walletVersion.current) {
        setMessage(`상품 조회 실패: ${errorMessage(error)}`);
      }
    } finally {
      provider?.destroy();
      busy.current = false;
      setIsLoading(false);
    }
  };

  // 전송 후에는 고정된 Kairos RPC로 확인하므로 지갑의 네트워크 변경에 영향을 받지 않습니다.
  const checkBookingTransaction = async (transaction: BookingTransaction) => {
    const receiptProvider = new JsonRpcProvider(KAIROS_RPC_URL, KAIROS_CHAIN_ID, { batchMaxCount: 1 });
    try {
      await receiptProvider.getNetwork();
      const receipt = await receiptProvider.waitForTransaction(transaction.hash, 1, 60_000);
      if (!receipt) throw new Error("트랜잭션 확정을 기다리고 있습니다.");
      setBookingTransaction(bookingFromReceipt(receipt, transaction));
    } catch (error) {
      setBookingTransaction({
        ...transaction,
        status: "unconfirmed",
        message: `예약 결과를 아직 확인하지 못했습니다. 재예약하지 말고 결과를 다시 확인해주세요. ${isError(error, "TIMEOUT") ? "확인 대기 시간이 지났습니다." : errorMessage(error)}`,
      });
    } finally {
      receiptProvider.destroy();
    }
  };

  const createBooking = async () => {
    if (busy.current || !isConsumer || !bookingReview || bookingLocked) return;
    const ethereum = getMetaMask();
    if (!ethereum) {
      setBookingError("MetaMask를 활성화한 뒤 다시 연결해주세요.");
      return;
    }
    const review = bookingReview;
    const version = walletVersion.current;
    busy.current = true;
    setBookingPhase("preparing");
    setBookingError("");
    setBookingTransaction(null);
    let provider: BrowserProvider | undefined;
    try {
      const [accounts, chain] = await Promise.all([
        ethereum.request({ method: "eth_accounts" }),
        ethereum.request({ method: "eth_chainId" }),
      ]);
      if (parseChainId(chain) !== KAIROS_CHAIN_ID) throw new Error("Kairos 네트워크에서만 예약할 수 있습니다.");
      if (firstAccount(accounts).toLowerCase() !== review.buyer.toLowerCase()) {
        throw new Error("연결 계정이 변경되었습니다. 상품과 소비자 주소를 다시 확인해주세요.");
      }
      provider = new BrowserProvider(ethereum, undefined, { cacheTimeout: -1 });
      if (parseChainId(await ethereum.request({ method: "eth_chainId" })) !== KAIROS_CHAIN_ID) {
        throw new Error("Kairos 네트워크에서만 예약할 수 있습니다.");
      }
      const signer = await provider.getSigner(review.buyer);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const latestProduct = await contract.getProduct(1);
      if (!latestProduct.exists || !latestProduct.active) throw new Error("현재 예약할 수 없는 상품입니다. 상품을 다시 불러와주세요.");
      if (latestProduct.vendor.toLowerCase() === review.buyer.toLowerCase()) {
        throw new Error("업체는 자신의 상품을 예약할 수 없습니다. 소비자 계정을 연결해주세요.");
      }
      if (latestProduct.priceKRW.toString() !== review.product.priceKRW
        || latestProduct.vendor.toLowerCase() !== review.product.vendor.toLowerCase()
        || latestProduct.name !== review.product.name) {
        setProduct(null);
        setBookingReview(null);
        throw new Error("상품 정보가 변경되었습니다. 상품을 다시 불러온 뒤 예약 내용을 확인해주세요.");
      }
      if (version !== walletVersion.current) throw new Error("계정 또는 네트워크가 변경되었습니다. 예약 내용을 다시 확인해주세요.");

      setBookingPhase("signing");
      // chainId를 함께 전달해 다른 체인에서 같은 주소로 전송되지 않도록 합니다.
      const tx = await contract.createBooking(1, { chainId: KAIROS_CHAIN_ID });
      const transaction: BookingTransaction = {
        hash: tx.hash,
        buyer: review.buyer,
        vendor: review.product.vendor,
        status: "pending",
        message: "트랜잭션을 전송했습니다. 블록 포함을 확인하고 있습니다.",
      };
      setBookingTransaction(transaction);
      setBookingReview(null);
      setBookingPhase("pending");
      await checkBookingTransaction(transaction);
    } catch (error) {
      setBookingError(bookingErrorMessage(error));
    } finally {
      provider?.destroy();
      busy.current = false;
      setBookingPhase("");
    }
  };

  const retryBookingReceipt = async () => {
    if (busy.current || !bookingTransaction) return;
    busy.current = true;
    setBookingPhase("pending");
    try {
      await checkBookingTransaction(bookingTransaction);
    } finally {
      busy.current = false;
      setBookingPhase("");
    }
  };

  const checkAcceptTransaction = async (transaction: AcceptTransaction) => {
    const receiptProvider = new JsonRpcProvider(KAIROS_RPC_URL, KAIROS_CHAIN_ID, { batchMaxCount: 1 });
    try {
      await receiptProvider.getNetwork();
      const receipt = await receiptProvider.waitForTransaction(transaction.hash, 1, 60_000);
      if (!receipt) throw new Error("승인 트랜잭션 확정을 기다리고 있습니다.");
      const result = acceptanceFromReceipt(receipt, transaction);
      setAcceptTransaction(result);
      // 현재 연결 계정의 목록을 다시 읽습니다. 전송 당시 계정으로 덮어쓰지 않습니다.
      refreshAccountView();
    } catch (error) {
      setAcceptTransaction({
        ...transaction, status: "unconfirmed",
        message: `승인 결과를 아직 확인하지 못했습니다. 다시 승인하지 말고 결과를 재조회해주세요. ${isError(error, "TIMEOUT") ? "확인 대기 시간이 지났습니다." : errorMessage(error)}`,
      });
    } finally {
      receiptProvider.destroy();
    }
  };

  const acceptBooking = async (review: VendorBooking) => {
    if (busy.current || !isVendor || review.id !== TARGET_BOOKING_ID.toString()
      || review.status !== 0 || acceptLocked) return;
    const ethereum = getMetaMask();
    if (!ethereum) {
      setAcceptError("MetaMask를 활성화한 뒤 다시 연결해주세요.");
      return;
    }
    const version = walletVersion.current;
    busy.current = true;
    setAcceptPhase("preparing");
    setAcceptError("");
    setAcceptTransaction(null);
    let provider: BrowserProvider | undefined;
    try {
      const [accounts, chain] = await Promise.all([
        ethereum.request({ method: "eth_accounts" }),
        ethereum.request({ method: "eth_chainId" }),
      ]);
      if (parseChainId(chain) !== KAIROS_CHAIN_ID) throw new Error("Kairos 네트워크에서만 승인할 수 있습니다.");
      if (firstAccount(accounts).toLowerCase() !== review.vendor.toLowerCase()) {
        throw new Error("이 예약의 업체 계정을 연결해주세요.");
      }
      provider = new BrowserProvider(ethereum, undefined, { cacheTimeout: -1 });
      if (parseChainId(await ethereum.request({ method: "eth_chainId" })) !== KAIROS_CHAIN_ID) throw new Error("Kairos 네트워크에서만 승인할 수 있습니다.");
      const signer = await provider.getSigner(review.vendor);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const productOne = await contract.getProduct(1);
      if (!productOne.exists || productOne.id !== BigInt(1)
        || productOne.vendor.toLowerCase() !== review.vendor.toLowerCase()) {
        throw new Error("Product #1의 업체 계정만 승인할 수 있습니다.");
      }
      const latestBooking = await contract.getBooking(TARGET_BOOKING_ID);
      if (version !== walletVersion.current) throw new Error("계정 또는 네트워크가 변경되었습니다. 예약을 다시 확인해주세요.");
      if (!latestBooking.exists || latestBooking.vendor.toLowerCase() !== review.vendor.toLowerCase()
        || latestBooking.id !== TARGET_BOOKING_ID || latestBooking.productId !== BigInt(1)) {
        throw new Error("이 업체의 예약 정보를 확인할 수 없습니다.");
      }
      if (latestBooking.status !== BigInt(0)) {
        setVendorBookings((bookings) => bookings?.map((booking) => booking.id === review.id
          ? { ...booking, status: Number(latestBooking.status) } : booking) ?? null);
        throw new Error("이미 처리되거나 취소된 예약입니다. Requested 예약만 승인할 수 있습니다.");
      }
      if (version !== walletVersion.current) throw new Error("계정 또는 네트워크가 변경되었습니다. 예약을 다시 확인해주세요.");
      setAcceptPhase("signing");
      const tx = await contract.acceptBooking(TARGET_BOOKING_ID, { chainId: KAIROS_CHAIN_ID });
      const transaction: AcceptTransaction = {
        hash: tx.hash, bookingId: review.id, vendor: review.vendor, status: "pending",
        message: "승인 트랜잭션을 전송했습니다. 블록 포함을 확인하고 있습니다.",
      };
      setAcceptTransaction(transaction);
      setAcceptPhase("pending");
      await checkAcceptTransaction(transaction);
    } catch (error) {
      setAcceptError(bookingErrorMessage(error));
    } finally {
      provider?.destroy();
      busy.current = false;
      setAcceptPhase("");
    }
  };

  const retryAcceptReceipt = async () => {
    if (busy.current || !acceptTransaction) return;
    busy.current = true;
    setAcceptPhase("pending");
    try {
      await checkAcceptTransaction(acceptTransaction);
    } finally {
      busy.current = false;
      setAcceptPhase("");
    }
  };

  const checkCompleteTransaction = async (transaction: CompleteTransaction) => {
    const receiptProvider = new JsonRpcProvider(KAIROS_RPC_URL, KAIROS_CHAIN_ID, { batchMaxCount: 1 });
    try {
      await receiptProvider.getNetwork();
      const receipt = await receiptProvider.waitForTransaction(transaction.hash, 1, 60_000);
      if (!receipt) throw new Error("이용 완료 트랜잭션 확정을 기다리고 있습니다.");
      setCompleteTransaction(completionFromReceipt(receipt, transaction));
      // 완료 후 getBooking(2)를 다시 조회해 현재 계정의 화면을 갱신합니다.
      refreshAccountView();
    } catch (error) {
      setCompleteTransaction({
        ...transaction, status: "unconfirmed",
        message: `이용 완료 결과를 아직 확인하지 못했습니다. 다시 전송하지 말고 결과를 재조회해주세요. ${isError(error, "TIMEOUT") ? "확인 대기 시간이 지났습니다." : errorMessage(error)}`,
      });
    } finally {
      receiptProvider.destroy();
    }
  };

  const completeBooking = async () => {
    if (busy.current || !isBookingBuyer || !buyerBooking || buyerBooking.status !== 1 || completeLocked) return;
    const ethereum = getMetaMask();
    if (!ethereum) {
      setCompleteError("MetaMask를 활성화한 뒤 다시 연결해주세요.");
      return;
    }
    const buyer = buyerBooking.buyer;
    const version = walletVersion.current;
    busy.current = true;
    setCompletePhase("preparing");
    setCompleteError("");
    setCompleteTransaction(null);
    let provider: BrowserProvider | undefined;
    try {
      const [accounts, chain] = await Promise.all([
        ethereum.request({ method: "eth_accounts" }),
        ethereum.request({ method: "eth_chainId" }),
      ]);
      if (parseChainId(chain) !== KAIROS_CHAIN_ID) throw new Error("Kairos 네트워크에서만 이용 완료를 등록할 수 있습니다.");
      if (firstAccount(accounts).toLowerCase() !== buyer.toLowerCase()) throw new Error("Booking #2의 소비자 계정을 연결해주세요.");
      provider = new BrowserProvider(ethereum, undefined, { cacheTimeout: -1 });
      const signer = await provider.getSigner(buyer);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const latestBooking = await contract.getBooking(TARGET_BOOKING_ID);
      if (version !== walletVersion.current) throw new Error("계정 또는 네트워크가 변경되었습니다. 예약을 다시 확인해주세요.");
      if (!latestBooking.exists || latestBooking.id !== TARGET_BOOKING_ID
        || latestBooking.buyer.toLowerCase() !== buyer.toLowerCase()) {
        throw new Error("Booking #2의 소비자 정보를 확인할 수 없습니다.");
      }
      if (latestBooking.status !== BigInt(1)) {
        setBuyerBooking((booking) => booking ? { ...booking, status: Number(latestBooking.status) } : null);
        throw new Error("Accepted (1) 예약만 이용 완료를 등록할 수 있습니다.");
      }
      const finalChain = parseChainId(await ethereum.request({ method: "eth_chainId" }));
      if (version !== walletVersion.current || finalChain !== KAIROS_CHAIN_ID) {
        throw new Error("계정 또는 네트워크가 변경되었습니다. Kairos에서 다시 확인해주세요.");
      }
      setCompletePhase("signing");
      const tx = await contract.completeBooking(TARGET_BOOKING_ID, { chainId: KAIROS_CHAIN_ID });
      const transaction: CompleteTransaction = {
        hash: tx.hash, bookingId: TARGET_BOOKING_ID.toString(), buyer, status: "pending",
        message: "이용 완료 트랜잭션을 전송했습니다. 블록 포함을 확인하고 있습니다.",
      };
      setCompleteTransaction(transaction);
      setCompletePhase("pending");
      await checkCompleteTransaction(transaction);
    } catch (error) {
      setCompleteError(bookingErrorMessage(error));
    } finally {
      provider?.destroy();
      busy.current = false;
      setCompletePhase("");
    }
  };

  const retryCompleteReceipt = async () => {
    if (busy.current || !completeTransaction) return;
    busy.current = true;
    setCompletePhase("pending");
    try {
      await checkCompleteTransaction(completeTransaction);
    } finally {
      busy.current = false;
      setCompletePhase("");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg p-8">

        <h1 className="text-3xl font-bold mb-2">
          Wedding Chain
        </h1>

        <p className="text-gray-500 mb-8">
          Kaia 기반 스드메 예약 DApp
        </p>

        <button
          onClick={connectWallet}
          disabled={isBusy}
          className="w-full bg-black text-white py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isConnecting ? "MetaMask 연결 중…" : "MetaMask 지갑 연결"}
        </button>

        <div className="mt-6 space-y-3">
          <div>
            <p className="text-sm text-gray-500">네트워크</p>
            <p>{chainId === null
              ? "연결되지 않음"
              : isKairos ? "Kaia Kairos Testnet (Chain ID: 1001)" : `지원하지 않는 네트워크 (Chain ID: ${chainId})`}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">
              연결된 지갑
            </p>

            <p className="font-mono text-sm break-all">
              {account || "연결되지 않음"}
            </p>
          </div>
        </div>

        <hr className="my-8" />

        {!account ? (
          <p className="text-sm text-gray-600">먼저 MetaMask 지갑을 연결해주세요.</p>
        ) : !isKairos ? (
          <p className="text-sm text-gray-600">MetaMask에서 Kaia Kairos Testnet(Chain ID: 1001)을 선택해주세요.</p>
        ) : !currentRole ? (
          <p role="status" className="text-sm text-gray-600">계정 유형을 확인하고 있습니다…</p>
        ) : currentRole.kind === "error" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-800">{currentRole.error}</p>
            <button onClick={refreshAccountView} disabled={isBusy} className="border rounded-xl px-4 py-2 disabled:opacity-50">계정 유형 다시 확인</button>
          </div>
        ) : (
          <div className="mb-5">
            <h2 className="text-xl font-bold">{isVendor ? "업체 예약 관리" : "소비자 예약"}</h2>
            <p className="mt-2 text-sm text-gray-600">{isVendor
              ? "Product #1의 Booking #2를 확인하고 승인할 수 있습니다."
              : "상품을 확인하고 소비자 계정으로 예약을 요청할 수 있습니다."}</p>
          </div>
        )}

        {isConsumer && <>
        <button
          onClick={loadProduct}
          disabled={!account || !isKairos || isBusy}
          className="w-full border border-black py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "상품 불러오는 중…" : "Studio 상품 불러오기"}
        </button>

        {product && (
          <div className="mt-6 border rounded-2xl p-6">

            <p className="text-sm text-gray-500">
              Product ID: {product.id}
            </p>

            <h2 className="text-2xl font-bold mt-1">
              {product.name}
            </h2>

            <p className="text-sm text-gray-500 mt-4">가격 (priceKRW)</p>
            <p className="text-2xl font-semibold mt-1">
              {BigInt(product.priceKRW).toLocaleString("ko-KR")}원
            </p>

            <div className="mt-5 text-sm space-y-2">
              <p>
                판매 상태:{" "}
                {product.active ? "판매 중 (active: true)" : "판매 중지 (active: false)"}
              </p>

              <p className="break-all">
                업체 지갑 주소: {product.vendor}
              </p>

              <p className="break-all">
                metadataURI: {product.metadataURI || "등록되지 않음"}
              </p>
            </div>

            <button
              onClick={() => {
                setBookingReview({ product: { ...product }, buyer: account });
                setBookingError("");
              }}
              disabled={!account || !isKairos || !product.active || isProductVendor || isBusy || bookingLocked}
              className="mt-6 w-full bg-black text-white py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              예약하기
            </button>
            {isProductVendor && <p className="mt-3 text-sm text-gray-600">업체는 자신의 상품을 예약할 수 없습니다. 소비자 계정으로 연결해주세요.</p>}
            {!product.active && <p className="mt-3 text-sm text-gray-600">판매 중지된 상품은 예약할 수 없습니다.</p>}
          </div>
        )}

        {bookingReview && (
          <section aria-label="예약 내용 확인" className="mt-6 border rounded-2xl p-6 space-y-3">
            <h2 className="text-xl font-bold">예약 내용 확인</h2>
            <p>Product #1 · {bookingReview.product.name}</p>
            <p>현재 예약 가격: {BigInt(bookingReview.product.priceKRW).toLocaleString("ko-KR")}원</p>
            <p className="text-sm break-all">소비자: {bookingReview.buyer}</p>
            <p className="text-sm break-all">업체: {bookingReview.product.vendor}</p>
            <p className="text-sm">Kaia Kairos Testnet · Chain ID: 1001</p>
            <p className="text-sm break-all">예약 컨트랙트: {CONTRACT_ADDRESS}</p>
            <p className="text-sm text-gray-600">예약 요청을 등록합니다. 상품 대금은 결제되지 않으며 테스트 KAIA 가스비가 발생합니다. 가스비는 MetaMask에서 확인해주세요.</p>
            <p className="text-sm text-gray-600">실제 예약 가격은 트랜잭션 처리 시점의 상품 가격으로 기록됩니다. 처리 전에 업체가 가격을 변경하면 위 금액과 달라질 수 있습니다.</p>
            <button onClick={createBooking} disabled={isBusy || bookingLocked}
              className="w-full bg-black text-white py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              {bookingPhase === "preparing" ? "예약 조건 확인 중…" : bookingPhase === "signing" ? "MetaMask 승인 대기 중…" : "확인하고 MetaMask에서 예약 승인"}
            </button>
            <button onClick={() => setBookingReview(null)} disabled={isBusy}
              className="w-full border py-2 rounded-xl disabled:opacity-50">취소</button>
          </section>
        )}
        {bookingError && <p role="alert" className="mt-6 bg-red-50 text-red-800 rounded-xl p-4 text-sm break-words">{bookingError}</p>}
        </>}

        {isVendor && (
          <section aria-label="업체 예약 목록" className="space-y-4">
            <p className="text-sm break-all">Product #1 업체: {currentRole.productVendor}</p>
            <button onClick={refreshAccountView} disabled={isBusy}
              className="w-full border border-black py-3 rounded-xl font-semibold disabled:opacity-50">Booking #2 새로고침</button>
            {vendorListError ? <p role="alert" className="text-sm text-red-800 break-words">{vendorListError}</p>
              : vendorBookings === null ? <p role="status">Booking #2를 불러오는 중…</p>
              : vendorBookings.length === 0 ? <p>Booking #2가 없습니다.</p>
              : vendorBookings.map((booking) => (
                <article key={booking.id} className="border rounded-2xl p-5 space-y-3">
                  <h3 className="text-lg font-bold">Booking ID: {booking.id}</h3>
                  <p>productId: {booking.productId}</p>
                  <p className="text-sm break-all">buyer: {booking.buyer}</p>
                  <p className="text-sm break-all">vendor: {booking.vendor}</p>
                  <p>bookedPriceKRW: {BigInt(booking.priceKRW).toLocaleString("ko-KR")}원</p>
                  <p>status: {BOOKING_STATUS_LABELS[booking.status] ?? "알 수 없는 상태"}</p>
                  <p className="text-sm text-gray-600">요청 일시: {new Date(Number(booking.createdAt) * 1000).toLocaleString("ko-KR")}</p>
                  {booking.status === 0 && (
                    <>
                    <p className="text-sm text-gray-600">위 예약을 승인해 Requested (0)에서 Accepted (1)로 변경합니다. 테스트 KAIA 가스비는 MetaMask에서 확인해주세요.</p>
                    <button onClick={() => acceptBooking(booking)}
                      disabled={isBusy || acceptLocked || (acceptTransaction?.status === "success" && acceptTransaction.bookingId === booking.id)}
                      className="w-full bg-black text-white py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                      {acceptPhase === "preparing" ? "승인 조건 확인 중…" : acceptPhase === "signing" ? "MetaMask 승인 대기 중…" : acceptPhase === "pending" ? "승인 결과 확인 중…" : "예약 승인"}
                    </button>
                    </>
                  )}
                </article>
              ))}
            {acceptError && <p role="alert" className="bg-red-50 text-red-800 rounded-xl p-4 text-sm break-words">{acceptError}</p>}
          </section>
        )}

        {isBookingBuyer && buyerBooking && (
          <section aria-label="소비자 예약 관리" className="mt-6 border rounded-2xl p-6 space-y-3">
            <h2 className="text-xl font-bold">소비자 예약 관리</h2>
            <p>Booking ID: {buyerBooking.id}</p>
            <p className="text-sm break-all">buyer: {buyerBooking.buyer}</p>
            <p className="text-sm break-all">vendor: {buyerBooking.vendor}</p>
            <p>productId: {buyerBooking.productId}</p>
            <p>bookedPriceKRW: {BigInt(buyerBooking.priceKRW).toLocaleString("ko-KR")}원</p>
            <p>status: {BOOKING_STATUS_LABELS[buyerBooking.status] ?? "알 수 없는 상태"}</p>
            <button onClick={refreshAccountView} disabled={isBusy} className="w-full border py-2 rounded-xl disabled:opacity-50">내 Booking #2 새로고침</button>
            {buyerBooking.status === 1 && (
              <>
                <p className="text-sm text-gray-600">서비스 이용을 완료했다면 등록해주세요. Accepted (1)에서 Completed (2)로 변경되며 테스트 KAIA 가스비가 발생합니다.</p>
                <button onClick={completeBooking}
                  disabled={isBusy || completeLocked || completeTransaction?.status === "success"}
                  className="w-full bg-black text-white py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                  {completePhase === "preparing" ? "완료 조건 확인 중…" : completePhase === "signing" ? "MetaMask 승인 대기 중…" : completePhase === "pending" ? "이용 완료 결과 확인 중…" : "이용 완료"}
                </button>
              </>
            )}
            {completeError && <p role="alert" className="bg-red-50 text-red-800 rounded-xl p-4 text-sm break-words">{completeError}</p>}
          </section>
        )}
        {isConsumer && buyerBookingError && (
          <div className="mt-6 space-y-3">
            <p role="alert" className="text-sm text-red-800 break-words">{buyerBookingError}</p>
            <button onClick={refreshAccountView} disabled={isBusy} className="border rounded-xl px-4 py-2 disabled:opacity-50">내 예약 다시 확인</button>
          </div>
        )}

        {completeTransaction && (
          <section aria-label="이용 완료 결과" aria-live="polite" className="mt-6 border rounded-2xl p-6 space-y-3">
            <h2 className="text-xl font-bold">{completeTransaction.status === "success" ? "이용 완료 등록 성공" : "이용 완료 트랜잭션"}</h2>
            <p>{completeTransaction.message}</p>
            <p>Booking ID: {completeTransaction.bookingId}</p>
            <p className="text-sm break-all">소비자: {completeTransaction.buyer}</p>
            <p className="text-sm">Kaia Kairos Testnet · Chain ID: 1001</p>
            <p className="text-sm break-all">Transaction hash: <a href={`https://kairos.kaiascan.io/tx/${completeTransaction.hash}`}
              target="_blank" rel="noopener noreferrer" className="underline">{completeTransaction.hash}</a></p>
            {completeTransaction.status === "unconfirmed" && (
              <button onClick={retryCompleteReceipt} disabled={isBusy} className="w-full border py-3 rounded-xl disabled:opacity-50">
                {completePhase === "pending" ? "이용 완료 결과 확인 중…" : "이용 완료 결과 다시 확인"}
              </button>
            )}
          </section>
        )}

        {bookingTransaction && (
          <section aria-label="예약 결과" aria-live="polite" className="mt-6 border rounded-2xl p-6 space-y-3">
            <h2 className="text-xl font-bold">{bookingTransaction.status === "success" ? "예약 요청 완료" : "예약 트랜잭션"}</h2>
            <p>{bookingTransaction.message}</p>
            <p className="text-sm">Kaia Kairos Testnet · Product #1</p>
            <p className="text-sm break-all">예약 소비자: {bookingTransaction.buyer}</p>
            <p className="text-sm break-all">Transaction hash: <a
              href={`https://kairos.kaiascan.io/tx/${bookingTransaction.hash}`}
              target="_blank" rel="noopener noreferrer" className="underline">{bookingTransaction.hash}</a></p>
            {bookingTransaction.bookingId && bookingTransaction.priceKRW !== undefined && (
              <>
                <p className="font-semibold">Booking ID: {bookingTransaction.bookingId}</p>
                <p>생성 당시 상태: Requested (업체 승인 대기)</p>
                <p>기록된 예약 가격: {BigInt(bookingTransaction.priceKRW).toLocaleString("ko-KR")}원</p>
              </>
            )}
            {bookingTransaction.status === "unconfirmed" && (
              <button onClick={retryBookingReceipt} disabled={isBusy} className="w-full border py-3 rounded-xl disabled:opacity-50">
                {bookingPhase === "pending" ? "예약 결과 확인 중…" : "예약 결과 다시 확인"}
              </button>
            )}
          </section>
        )}

        {acceptTransaction && (
          <section aria-label="업체 승인 결과" aria-live="polite" className="mt-6 border rounded-2xl p-6 space-y-3">
            <h2 className="text-xl font-bold">{acceptTransaction.status === "success" ? "업체 승인 완료" : "업체 승인 트랜잭션"}</h2>
            <p>{acceptTransaction.message}</p>
            <p>Booking ID: {acceptTransaction.bookingId}</p>
            <p className="text-sm break-all">승인 업체: {acceptTransaction.vendor}</p>
            <p className="text-sm">Kaia Kairos Testnet · Chain ID: 1001</p>
            <p className="text-sm break-all">Transaction hash: <a href={`https://kairos.kaiascan.io/tx/${acceptTransaction.hash}`}
              target="_blank" rel="noopener noreferrer" className="underline">{acceptTransaction.hash}</a></p>
            {acceptTransaction.status === "unconfirmed" && (
              <button onClick={retryAcceptReceipt} disabled={isBusy} className="w-full border py-3 rounded-xl disabled:opacity-50">
                {acceptPhase === "pending" ? "승인 결과 확인 중…" : "승인 결과 다시 확인"}
              </button>
            )}
          </section>
        )}

        {message && (
          <div role="status" aria-live="polite" className="mt-6 bg-gray-100 rounded-xl p-4 text-sm break-words">
            {message}
          </div>
        )}

      </div>
    </main>
  );
}
