"use client";

import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  isAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";

import type {
  ContractTransactionResponse,
  Eip1193Provider,
} from "ethers";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  CSSProperties,
  ReactNode,
} from "react";

// =========================================================
// Network / Contract
// =========================================================

const CONTRACT_ADDRESS =
  "0x38737d4B70Ec1a6857A3593Bc1C073D791f0D8b5";

const KAIROS_RPC_URL =
  "https://public-en-kairos.node.kaia.io";

const KAIROS_CHAIN_ID = "0x3e9"; // 1001

const KAIASCAN_URL =
  "https://kairos.kaiascan.io";

// =========================================================
// ABI
// =========================================================

const CONTRACT_ABI = [
  // Owner
  "function owner() view returns (address)",

  // Vendor
  "function requestVendorRegistration(uint8 category, string metadataURI)",
  "function approveVendor(address vendorWallet)",
  "function rejectVendor(address vendorWallet)",
  "function getVendorApplication(address vendorWallet) view returns (tuple(address wallet, uint8 category, string metadataURI, uint8 status, uint256 requestedAt, uint256 reviewedAt, bool exists))",
  "function isVerifiedVendor(address vendorWallet) view returns (bool)",

  // Agreement
  "function createAgreement(address buyer, bytes32 documentHash, uint256 amountKRW) returns (uint256)",
  "function proposeAgreementVersion(uint256 agreementId, bytes32 newDocumentHash, uint256 newAmountKRW) returns (uint256)",
  "function approveAgreementVersion(uint256 agreementId, uint256 version)",

  // Read
  "function getAgreement(uint256 agreementId) view returns (tuple(uint256 id, address buyer, address vendor, uint256 activeVersion, uint256 latestVersion, uint8 status, uint256 createdAt, bool exists))",

  "function getAgreementVersion(uint256 agreementId, uint256 version) view returns (tuple(uint256 version, bytes32 documentHash, uint256 amountKRW, bool buyerApproved, bool vendorApproved, uint256 createdAt, bool exists))",

  "function getBuyerAgreementIds(address buyer) view returns (uint256[])",
  "function getVendorAgreementIds(address vendor) view returns (uint256[])",
  "function getAgreementCount() view returns (uint256)",
];

// =========================================================
// Types
// =========================================================

type WalletProvider =
  Eip1193Provider & {
    on?: (
      event: string,
      listener: (...args: unknown[]) => void
    ) => void;

    removeListener?: (
      event: string,
      listener: (...args: unknown[]) => void
    ) => void;
  };

declare global {
  interface Window {
    ethereum?: WalletProvider;
  }
}

type VendorApplication = {
  wallet: string;
  category: number;
  metadataURI: string;
  status: number;
  requestedAt: string;
  reviewedAt: string;
  exists: boolean;
};

type AgreementVersion = {
  version: number;
  documentHash: string;
  amountKRW: string;
  buyerApproved: boolean;
  vendorApproved: boolean;
  createdAt: string;
  exists: boolean;
};

type AgreementData = {
  id: number;
  buyer: string;
  vendor: string;
  activeVersion: number;
  latestVersion: number;
  status: number;
  createdAt: string;
  exists: boolean;
  versions: AgreementVersion[];
};

// =========================================================
// Labels
// =========================================================

const CATEGORY_NAMES = [
  "Studio",
  "Dress",
  "Makeup",
];

const VENDOR_STATUS_NAMES = [
  "None",
  "Pending",
  "Verified",
  "Rejected",
];

const AGREEMENT_STATUS_NAMES = [
  "None",
  "Pending Approval",
  "Active",
  "Change Pending",
  "Cancelled",
];

// =========================================================
// Helpers
// =========================================================

function shortAddress(
  address: string
) {
  if (!address) return "-";

  return `${address.slice(
    0,
    6
  )}...${address.slice(-4)}`;
}

function formatKRW(
  amount: string
) {
  try {
    return `${BigInt(
      amount
    ).toLocaleString("ko-KR")}원`;
  } catch {
    return `${amount}원`;
  }
}

function formatDate(
  timestamp: string
) {
  if (
    !timestamp ||
    timestamp === "0"
  ) {
    return "-";
  }

  return new Date(
    Number(timestamp) * 1000
  ).toLocaleString("ko-KR");
}

function isBytes32(
  value: string
) {
  return /^0x[a-fA-F0-9]{64}$/.test(
    value
  );
}

function getErrorMessage(
  error: unknown
) {
  if (
    typeof error === "object" &&
    error !== null
  ) {
    const data = error as {
      code?: unknown;
      reason?: unknown;
      shortMessage?: unknown;
      message?: unknown;
    };

    if (
      data.code === 4001 ||
      data.code ===
        "ACTION_REJECTED"
    ) {
      return "MetaMask 요청을 취소했습니다.";
    }

    if (
      typeof data.reason ===
      "string"
    ) {
      return data.reason;
    }

    if (
      typeof data.shortMessage ===
      "string"
    ) {
      return data.shortMessage;
    }

    if (
      typeof data.message ===
      "string"
    ) {
      return data.message;
    }
  }

  return "알 수 없는 오류가 발생했습니다.";
}

function parseVendor(
  raw: {
    wallet: string;
    category: bigint;
    metadataURI: string;
    status: bigint;
    requestedAt: bigint;
    reviewedAt: bigint;
    exists: boolean;
  }
): VendorApplication {
  return {
    wallet: raw.wallet,
    category: Number(
      raw.category
    ),
    metadataURI:
      raw.metadataURI,
    status: Number(raw.status),
    requestedAt:
      raw.requestedAt.toString(),
    reviewedAt:
      raw.reviewedAt.toString(),
    exists: raw.exists,
  };
}

export default function AgreementDApp() {
  const [
    account,
    setAccount,
  ] = useState("");

  const [
    owner,
    setOwner,
  ] = useState("");

  const [
    verifiedVendor,
    setVerifiedVendor,
  ] = useState(false);

  const [
    ownVendorApplication,
    setOwnVendorApplication,
  ] =
    useState<VendorApplication | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    lastTxHash,
    setLastTxHash,
  ] = useState("");

  const [
    agreements,
    setAgreements,
  ] = useState<AgreementData[]>(
    []
  );

  const [
    agreementSearchId,
    setAgreementSearchId,
  ] = useState("1");

  const [
    category,
    setCategory,
  ] = useState("0");

  const [
    metadataURI,
    setMetadataURI,
  ] = useState(
    "demo://vendor/studio"
  );

  const [
    vendorLookupAddress,
    setVendorLookupAddress,
  ] = useState("");

  const [
    vendorLookupResult,
    setVendorLookupResult,
  ] =
    useState<VendorApplication | null>(
      null
    );

  const [
    buyerAddress,
    setBuyerAddress,
  ] = useState("");

  const [
    agreementText,
    setAgreementText,
  ] = useState("");

  const [
    documentHash,
    setDocumentHash,
  ] = useState("");

  const [
    amountKRW,
    setAmountKRW,
  ] = useState("3800000");

  const [
    versionAgreementId,
    setVersionAgreementId,
  ] = useState("1");

  const [
    newAgreementText,
    setNewAgreementText,
  ] = useState("");

  const [
    newDocumentHash,
    setNewDocumentHash,
  ] = useState("");

  const [
    newAmountKRW,
    setNewAmountKRW,
  ] = useState("4100000");

  const getReadContract =
    useCallback(() => {
      const provider =
        new JsonRpcProvider(
          KAIROS_RPC_URL
        );

      return new Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        provider
      );
    }, []);

  async function ensureKairos() {
    const ethereum =
      window.ethereum;

    if (!ethereum) {
      throw new Error(
        "MetaMask가 설치되어 있지 않습니다."
      );
    }

    const chainId =
      await ethereum.request({
        method: "eth_chainId",
      });

    if (
      typeof chainId ===
        "string" &&
      chainId.toLowerCase() ===
        KAIROS_CHAIN_ID
    ) {
      return;
    }

    try {
      await ethereum.request({
        method:
          "wallet_switchEthereumChain",
        params: [
          {
            chainId:
              KAIROS_CHAIN_ID,
          },
        ],
      });
    } catch {
      await ethereum.request({
        method:
          "wallet_addEthereumChain",
        params: [
          {
            chainId:
              KAIROS_CHAIN_ID,

            chainName:
              "Kaia Kairos Testnet",

            nativeCurrency: {
              name: "KAIA",
              symbol: "KAIA",
              decimals: 18,
            },

            rpcUrls: [
              KAIROS_RPC_URL,
            ],

            blockExplorerUrls: [
              KAIASCAN_URL,
            ],
          },
        ],
      });
    }
  }

  async function getWriteContract() {
    if (!window.ethereum) {
      throw new Error(
        "MetaMask가 필요합니다."
      );
    }

    await ensureKairos();

    const provider =
      new BrowserProvider(
        window.ethereum
      );

    const signer =
      await provider.getSigner();

    return new Contract(
      CONTRACT_ADDRESS,
      CONTRACT_ABI,
      signer
    );
  }

  const loadAgreement =
    useCallback(
      async (
        agreementId: number
      ): Promise<AgreementData> => {
        const contract =
          getReadContract();

        const raw =
          await contract.getAgreement(
            agreementId
          );

        const latestVersion =
          Number(
            raw.latestVersion
          );

        const versions: AgreementVersion[] =
          [];

        for (
          let version = 1;
          version <=
          latestVersion;
          version++
        ) {
          const versionRaw =
            await contract.getAgreementVersion(
              agreementId,
              version
            );

          versions.push({
            version: Number(
              versionRaw.version
            ),

            documentHash:
              versionRaw.documentHash,

            amountKRW:
              versionRaw.amountKRW.toString(),

            buyerApproved:
              versionRaw.buyerApproved,

            vendorApproved:
              versionRaw.vendorApproved,

            createdAt:
              versionRaw.createdAt.toString(),

            exists:
              versionRaw.exists,
          });
        }

        return {
          id: Number(raw.id),

          buyer: raw.buyer,

          vendor: raw.vendor,

          activeVersion:
            Number(
              raw.activeVersion
            ),

          latestVersion,

          status:
            Number(raw.status),

          createdAt:
            raw.createdAt.toString(),

          exists: raw.exists,

          versions,
        };
      },
      [getReadContract]
    );

  const loadAgreementList =
    useCallback(
      async (
        ids: number[]
      ) => {
        if (
          ids.length === 0
        ) {
          setAgreements([]);
          return;
        }

        const uniqueIds = [
          ...new Set(ids),
        ];

        const result =
          await Promise.all(
            uniqueIds.map(
              (id) =>
                loadAgreement(
                  id
                )
            )
          );

        result.sort(
          (a, b) =>
            b.id - a.id
        );

        setAgreements(
          result
        );
      },
      [loadAgreement]
    );

  const refreshProfile =
    useCallback(
      async (
        walletAddress: string
      ) => {
        const contract =
          getReadContract();

        const [
          ownerAddress,
          isVerified,
          buyerIdsRaw,
          vendorIdsRaw,
        ] = await Promise.all([
          contract.owner(),

          contract.isVerifiedVendor(
            walletAddress
          ),

          contract.getBuyerAgreementIds(
            walletAddress
          ),

          contract.getVendorAgreementIds(
            walletAddress
          ),
        ]);

        setOwner(
          ownerAddress
        );

        setVerifiedVendor(
          Boolean(isVerified)
        );

        const buyerIds =
          buyerIdsRaw.map(
            (value: bigint) =>
              Number(value)
          );

        const vendorIds =
          vendorIdsRaw.map(
            (value: bigint) =>
              Number(value)
          );

        await loadAgreementList([
          ...buyerIds,
          ...vendorIds,
        ]);

        try {
          const application =
            await contract.getVendorApplication(
              walletAddress
            );

          setOwnVendorApplication(
            parseVendor(
              application
            )
          );
        } catch {
          setOwnVendorApplication(
            null
          );
        }
      },
      [
        getReadContract,
        loadAgreementList,
      ]
    );

  async function connectWallet() {
    try {
      setLoading(true);

      setMessage(
        "MetaMask 연결 중..."
      );

      if (!window.ethereum) {
        throw new Error(
          "MetaMask가 설치되어 있지 않습니다."
        );
      }

      await ensureKairos();

      const accounts =
        await window.ethereum.request({
          method:
            "eth_requestAccounts",
        });

      if (
        !Array.isArray(
          accounts
        ) ||
        typeof accounts[0] !==
          "string"
      ) {
        throw new Error(
          "지갑 주소를 불러오지 못했습니다."
        );
      }

      const walletAddress =
        accounts[0];

      setAccount(
        walletAddress
      );

      await refreshProfile(
        walletAddress
      );

      setMessage(
        "Kaia Kairos Testnet 연결 성공"
      );
    } catch (error) {
      setMessage(
        getErrorMessage(error)
      );
    } finally {
      setLoading(false);
    }
  }

  async function runTransaction(
    action: (
      contract: Contract
    ) => Promise<ContractTransactionResponse>,
    successMessage: string
  ) {
    if (!account) {
      setMessage(
        "먼저 MetaMask를 연결해주세요."
      );

      return false;
    }

    try {
      setLoading(true);

      setLastTxHash("");

      setMessage(
        "MetaMask에서 트랜잭션을 확인해주세요."
      );

      const contract =
        await getWriteContract();

      const tx =
        await action(
          contract
        );

      setLastTxHash(
        tx.hash
      );

      setMessage(
        "블록체인 처리 중..."
      );

      await tx.wait();

      setMessage(
        successMessage
      );

      await refreshProfile(
        account
      );

      return true;
    } catch (error) {
      console.error(error);

      setMessage(
        getErrorMessage(error)
      );

      return false;
    } finally {
      setLoading(false);
    }
  }

  async function requestVendorRegistration() {
    if (
      !metadataURI.trim()
    ) {
      setMessage(
        "Metadata URI를 입력해주세요."
      );

      return;
    }

    await runTransaction(
      (contract) =>
        contract.requestVendorRegistration(
          Number(category),
          metadataURI
        ),

      "업체 등록 신청이 완료되었습니다."
    );
  }

  async function lookupVendor() {
    if (
      !isAddress(
        vendorLookupAddress
      )
    ) {
      setMessage(
        "올바른 업체 지갑 주소를 입력해주세요."
      );

      return;
    }

    try {
      setLoading(true);

      const contract =
        getReadContract();

      const raw =
        await contract.getVendorApplication(
          vendorLookupAddress
        );

      setVendorLookupResult(
        parseVendor(raw)
      );

      setMessage(
        "업체 신청 정보를 조회했습니다."
      );
    } catch (error) {
      setVendorLookupResult(
        null
      );

      setMessage(
        getErrorMessage(error)
      );
    } finally {
      setLoading(false);
    }
  }

  async function approveVendor() {
    if (
      !vendorLookupResult
    ) {
      return;
    }

    const success =
      await runTransaction(
        (contract) =>
          contract.approveVendor(
            vendorLookupResult.wallet
          ),

        "업체 승인이 완료되었습니다."
      );

    if (success) {
      await lookupVendor();
    }
  }

  async function rejectVendor() {
    if (
      !vendorLookupResult
    ) {
      return;
    }

    const success =
      await runTransaction(
        (contract) =>
          contract.rejectVendor(
            vendorLookupResult.wallet
          ),

        "업체 등록 신청을 거절했습니다."
      );

    if (success) {
      await lookupVendor();
    }
  }

  function generateV1Hash() {
    if (
      !agreementText.trim()
    ) {
      setMessage(
        "계약 내용을 입력해주세요."
      );

      return;
    }

    const hash =
      keccak256(
        toUtf8Bytes(
          agreementText
        )
      );

    setDocumentHash(
      hash
    );

    setMessage(
      "V1 계약 Hash를 생성했습니다. 계약 원문 자체는 블록체인에 전송되지 않습니다."
    );
  }

  async function createAgreement() {
    if (
      !isAddress(
        buyerAddress
      )
    ) {
      setMessage(
        "올바른 소비자 Wallet 주소를 입력해주세요."
      );

      return;
    }

    if (
      !isBytes32(
        documentHash
      )
    ) {
      setMessage(
        "먼저 계약 Hash를 생성해주세요."
      );

      return;
    }

    if (
      !amountKRW ||
      BigInt(amountKRW) <=
        BigInt(0)
    ) {
      setMessage(
        "계약 금액을 확인해주세요."
      );

      return;
    }

    await runTransaction(
      (contract) =>
        contract.createAgreement(
          buyerAddress,
          documentHash,
          BigInt(amountKRW)
        ),

      "V1 계약이 생성되었습니다. 이제 업체와 소비자 양측 승인이 필요합니다."
    );
  }

  function generateNewVersionHash() {
    if (
      !newAgreementText.trim()
    ) {
      setMessage(
        "변경된 계약 내용을 입력해주세요."
      );

      return;
    }

    const hash =
      keccak256(
        toUtf8Bytes(
          newAgreementText
        )
      );

    setNewDocumentHash(
      hash
    );

    setMessage(
      "새 계약 버전 Hash를 생성했습니다."
    );
  }

  async function proposeVersion() {
    if (
      !versionAgreementId ||
      Number(
        versionAgreementId
      ) <= 0
    ) {
      setMessage(
        "Agreement ID를 확인해주세요."
      );

      return;
    }

    if (
      !isBytes32(
        newDocumentHash
      )
    ) {
      setMessage(
        "새 계약 Hash를 생성해주세요."
      );

      return;
    }

    if (
      !newAmountKRW ||
      BigInt(
        newAmountKRW
      ) <= BigInt(0)
    ) {
      setMessage(
        "새 계약 금액을 확인해주세요."
      );

      return;
    }

    await runTransaction(
      (contract) =>
        contract.proposeAgreementVersion(
          BigInt(
            versionAgreementId
          ),

          newDocumentHash,

          BigInt(
            newAmountKRW
          )
        ),

      "새 계약 버전이 생성되었습니다. 양측 재승인 전까지 기존 계약이 유지됩니다."
    );
  }

  async function approveAgreementVersion(
    agreementId: number,
    version: number
  ) {
    await runTransaction(
      (contract) =>
        contract.approveAgreementVersion(
          agreementId,
          version
        ),

      `Agreement #${agreementId} V${version} 승인이 완료되었습니다.`
    );
  }

  async function searchAgreement() {
    const id =
      Number(
        agreementSearchId
      );

    if (
      !id ||
      id <= 0
    ) {
      setMessage(
        "Agreement ID를 확인해주세요."
      );

      return;
    }

    try {
      setLoading(true);

      const result =
        await loadAgreement(
          id
        );

      setAgreements(
        (previous) => {
          const others =
            previous.filter(
              (agreement) =>
                agreement.id !==
                id
            );

          return [
            result,
            ...others,
          ];
        }
      );

      setMessage(
        `Agreement #${id} 조회 성공`
      );
    } catch (error) {
      setMessage(
        getErrorMessage(error)
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const ethereum =
      window.ethereum;

    if (
      !ethereum?.on
    ) {
      return;
    }

    const reload =
      () => {
        window.location.reload();
      };

    ethereum.on(
      "accountsChanged",
      reload
    );

    ethereum.on(
      "chainChanged",
      reload
    );

    return () => {
      ethereum.removeListener?.(
        "accountsChanged",
        reload
      );

      ethereum.removeListener?.(
        "chainChanged",
        reload
      );
    };
  }, []);

  const isOwner =
    Boolean(account) &&
    Boolean(owner) &&
    account.toLowerCase() ===
      owner.toLowerCase();

  const isConsumer =
    Boolean(account) &&
    agreements.some(
      (agreement) =>
        agreement.buyer.toLowerCase() ===
        account.toLowerCase()
    );

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <section style={styles.hero}>
          <div>
            <p style={styles.eyebrow}>
              Wedding Chain
            </p>

            <h1 style={styles.title}>
              Wedding Chain
            </h1>

            <p style={styles.subtitle}>
              블록체인 기반 웨딩 계약관리 DApp
            </p>

            <p style={styles.description}>
              계약 원문은 Off-chain에 보관하고,
              계약 Hash · 버전 · 소비자/업체의 승인 이력을
              Kaia 블록체인에 기록합니다.
            </p>
          </div>

          <div style={styles.buttonRow}>
            <button
              onClick={
                connectWallet
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              {account
                ? "지갑 새로고침"
                : "MetaMask 연결"}
            </button>

            <a
              href={`${KAIASCAN_URL}/address/${CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              style={
                styles.linkButton
              }
            >
              Kaiascan
            </a>
          </div>

          <div style={styles.infoGrid}>
            <InfoBox
              title="Connected Wallet"
              value={
                account
                  ? shortAddress(
                      account
                    )
                  : "Not connected"
              }
            />

            <InfoBox
              title="Network"
              value="Kaia Kairos · 1001"
            />

            <InfoBox
              title="Contract"
              value={shortAddress(
                CONTRACT_ADDRESS
              )}
            />
          </div>

          {account && (
            <div style={styles.badgeRow}>
              {isOwner && (
                <Badge>
                  Platform Admin
                </Badge>
              )}

              {verifiedVendor && (
                <Badge>
                  Verified Vendor
                </Badge>
              )}

              {isConsumer && (
                <Badge>
                  Consumer
                </Badge>
              )}
            </div>
          )}
        </section>

        {message && (
          <section
            style={styles.message}
          >
            <strong>
              {message}
            </strong>

            {lastTxHash && (
              <a
                href={`${KAIASCAN_URL}/tx/${lastTxHash}`}
                target="_blank"
                rel="noreferrer"
                style={
                  styles.txLink
                }
              >
                거래 확인
              </a>
            )}
          </section>
        )}

        {isOwner && (
          <Section
            title="관리자 · 업체 검증"
            description="업체의 등록 신청을 조회한 뒤 Verified Vendor로 승인하거나 거절합니다."
          >
            <Field
              label="업체 Wallet Address"
            >
              <input
                value={
                  vendorLookupAddress
                }
                onChange={(
                  event
                ) =>
                  setVendorLookupAddress(
                    event.target
                      .value
                  )
                }
                placeholder="0x..."
                style={
                  styles.input
                }
              />
            </Field>

            <button
              onClick={
                lookupVendor
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              업체 신청 조회
            </button>

            {vendorLookupResult && (
              <div
                style={
                  styles.innerCard
                }
              >
                <DataRow
                  label="Wallet"
                  value={
                    vendorLookupResult.wallet
                  }
                />

                <DataRow
                  label="Category"
                  value={
                    CATEGORY_NAMES[
                      vendorLookupResult
                        .category
                    ] ?? "-"
                  }
                />

                <DataRow
                  label="Metadata URI"
                  value={
                    vendorLookupResult.metadataURI
                  }
                />

                <DataRow
                  label="Status"
                  value={
                    VENDOR_STATUS_NAMES[
                      vendorLookupResult
                        .status
                    ] ?? "-"
                  }
                />

                <DataRow
                  label="Requested At"
                  value={formatDate(
                    vendorLookupResult.requestedAt
                  )}
                />

                <DataRow
                  label="Reviewed At"
                  value={formatDate(
                    vendorLookupResult.reviewedAt
                  )}
                />

                {vendorLookupResult.status ===
                  1 && (
                  <div
                    style={
                      styles.buttonRow
                    }
                  >
                    <button
                      onClick={
                        approveVendor
                      }
                      disabled={
                        loading
                      }
                      style={
                        styles.primaryButton
                      }
                    >
                      업체 승인
                    </button>

                    <button
                      onClick={
                        rejectVendor
                      }
                      disabled={
                        loading
                      }
                      style={
                        styles.dangerButton
                      }
                    >
                      업체 거절
                    </button>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {account &&
          !isOwner &&
          !verifiedVendor &&
          !isConsumer && (
            <Section
              title="업체 등록"
              description="웨딩 업체로 참여하려면 관리자 검증을 먼저 받아야 합니다."
            >
              {ownVendorApplication ? (
                <div
                  style={
                    styles.innerCard
                  }
                >
                  <DataRow
                    label="Category"
                    value={
                      CATEGORY_NAMES[
                        ownVendorApplication
                          .category
                      ] ?? "-"
                    }
                  />

                  <DataRow
                    label="Status"
                    value={
                      VENDOR_STATUS_NAMES[
                        ownVendorApplication
                          .status
                      ] ?? "-"
                    }
                  />

                  <DataRow
                    label="Metadata"
                    value={
                      ownVendorApplication.metadataURI
                    }
                  />

                  {ownVendorApplication.status ===
                    1 && (
                    <p
                      style={
                        styles.help
                      }
                    >
                      관리자 승인을 기다리고 있습니다.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <Field
                    label="Category"
                  >
                    <select
                      value={
                        category
                      }
                      onChange={(
                        event
                      ) =>
                        setCategory(
                          event
                            .target
                            .value
                        )
                      }
                      style={
                        styles.input
                      }
                    >
                      <option value="0">
                        Studio
                      </option>

                      <option value="1">
                        Dress
                      </option>

                      <option value="2">
                        Makeup
                      </option>
                    </select>
                  </Field>

                  <Field
                    label="Metadata URI"
                  >
                    <input
                      value={
                        metadataURI
                      }
                      onChange={(
                        event
                      ) =>
                        setMetadataURI(
                          event
                            .target
                            .value
                        )
                      }
                      style={
                        styles.input
                      }
                    />
                  </Field>

                  <button
                    onClick={
                      requestVendorRegistration
                    }
                    disabled={
                      loading
                    }
                    style={
                      styles.primaryButton
                    }
                  >
                    업체 등록 신청
                  </button>
                </>
              )}
            </Section>
          )}

        {verifiedVendor && (
          <Section
            title="업체 · 최초 계약 생성"
            description="소비자에게 최초 계약을 제안합니다. 계약 원문은 온체인에 저장하지 않고 Hash만 기록합니다."
          >
            <div
              style={
                styles.twoColumns
              }
            >
              <Field
                label="소비자 Wallet"
              >
                <input
                  value={
                    buyerAddress
                  }
                  onChange={(
                    event
                  ) =>
                    setBuyerAddress(
                      event.target
                        .value
                    )
                  }
                  placeholder="0x..."
                  style={
                    styles.input
                  }
                />
              </Field>

              <Field
                label="계약 금액 (KRW)"
              >
                <input
                  type="number"
                  value={
                    amountKRW
                  }
                  onChange={(
                    event
                  ) =>
                    setAmountKRW(
                      event.target
                        .value
                    )
                  }
                  style={
                    styles.input
                  }
                />
              </Field>
            </div>

            <Field
              label="계약 내용"
            >
              <textarea
                value={
                  agreementText
                }
                onChange={(
                  event
                ) =>
                  setAgreementText(
                    event.target
                      .value
                  )
                }
                placeholder="예: Studio Premium Package, 3,800,000 KRW..."
                style={
                  styles.textarea
                }
              />
            </Field>

            <button
              onClick={
                generateV1Hash
              }
              style={
                styles.secondaryButton
              }
            >
              계약 Hash 생성
            </button>

            {documentHash && (
              <div
                style={
                  styles.hashBox
                }
              >
                {documentHash}
              </div>
            )}

            <button
              onClick={
                createAgreement
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              최초 계약 생성
            </button>
          </Section>
        )}

        {verifiedVendor && (
          <Section
            title="업체 · 계약 변경"
            description="기존 계약을 덮어쓰지 않고 새로운 계약 버전을 생성합니다."
          >
            <div
              style={
                styles.twoColumns
              }
            >
              <Field
                label="Agreement ID"
              >
                <input
                  type="number"
                  value={
                    versionAgreementId
                  }
                  onChange={(
                    event
                  ) =>
                    setVersionAgreementId(
                      event.target
                        .value
                    )
                  }
                  style={
                    styles.input
                  }
                />
              </Field>

              <Field
                label="변경 금액 (KRW)"
              >
                <input
                  type="number"
                  value={
                    newAmountKRW
                  }
                  onChange={(
                    event
                  ) =>
                    setNewAmountKRW(
                      event.target
                        .value
                    )
                  }
                  style={
                    styles.input
                  }
                />
              </Field>
            </div>

            <Field
              label="변경 계약 내용"
            >
              <textarea
                value={
                  newAgreementText
                }
                onChange={(
                  event
                ) =>
                  setNewAgreementText(
                    event.target
                      .value
                  )
                }
                placeholder="예: Dress option +300,000 KRW..."
                style={
                  styles.textarea
                }
              />
            </Field>

            <button
              onClick={
                generateNewVersionHash
              }
              style={
                styles.secondaryButton
              }
            >
              변경 계약 Hash 생성
            </button>

            {newDocumentHash && (
              <div
                style={
                  styles.hashBox
                }
              >
                {newDocumentHash}
              </div>
            )}

            <button
              onClick={
                proposeVersion
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              새 계약 버전 제안
            </button>
          </Section>
        )}

        <Section
          title="계약 조회"
          description="Agreement ID를 이용해 블록체인에 기록된 계약을 직접 조회할 수 있습니다."
        >
          <div
            style={
              styles.searchRow
            }
          >
            <input
              type="number"
              value={
                agreementSearchId
              }
              onChange={(
                event
              ) =>
                setAgreementSearchId(
                  event.target
                    .value
                )
              }
              style={{
                ...styles.input,
                maxWidth:
                  "220px",
              }}
            />

            <button
              onClick={
                searchAgreement
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              Agreement 조회
            </button>
          </div>
        </Section>

        {agreements.length >
          0 && (
          <section
            style={{
              marginTop:
                "30px",
            }}
          >
            <h2
              style={{
                fontSize:
                  "28px",
                marginBottom:
                  "20px",
              }}
            >
              계약 목록
            </h2>

            {agreements.map(
              (
                agreement
              ) => (
                <AgreementCard
                  key={
                    agreement.id
                  }
                  agreement={
                    agreement
                  }
                  account={
                    account
                  }
                  loading={
                    loading
                  }
                  onApprove={
                    approveAgreementVersion
                  }
                />
              )
            )}
          </section>
        )}

        <section
          style={
            styles.evidence
          }
        >
          <h2>
            Blockchain Evidence
          </h2>

          <p>
            Wedding Chain은 계약서 원문 전체를 블록체인에
            저장하지 않습니다. 계약 원문은 Off-chain에
            보관하고 Document Hash, 계약 버전, 소비자와
            업체의 승인 여부를 블록체인에 기록합니다.
          </p>

          <p>
            계약 변경 시 기존 계약을 삭제하거나 덮어쓰지
            않고 새로운 버전을 생성합니다. 새로운 버전은
            소비자와 업체의 재승인이 모두 완료된 후에만
            현재 효력이 있는 계약으로 변경됩니다.
          </p>
        </section>
      </div>
    </main>
  );
}

function AgreementCard({
  agreement,
  account,
  loading,
  onApprove,
}: {
  agreement: AgreementData;
  account: string;
  loading: boolean;
  onApprove: (
    agreementId: number,
    version: number
  ) => void;
}) {
  const accountLower =
    account.toLowerCase();

  const isBuyer =
    Boolean(account) &&
    accountLower ===
      agreement.buyer.toLowerCase();

  const isVendor =
    Boolean(account) &&
    accountLower ===
      agreement.vendor.toLowerCase();

  const latestVersion =
    agreement.versions.find(
      (version) =>
        version.version ===
        agreement.latestVersion
    );

  const buyerCanApprove =
    Boolean(
      isBuyer &&
        latestVersion &&
        !latestVersion.buyerApproved &&
        (agreement.status ===
          1 ||
          agreement.status ===
            3)
    );

  const vendorCanApprove =
    Boolean(
      isVendor &&
        latestVersion &&
        !latestVersion.vendorApproved &&
        (agreement.status ===
          1 ||
          agreement.status ===
            3)
    );

  return (
    <article
      style={
        styles.agreementCard
      }
    >
      <div
        style={
          styles.agreementHeader
        }
      >
        <div>
          <p
            style={
              styles.eyebrow
            }
          >
            Agreement
          </p>

          <h3
            style={{
              fontSize:
                "28px",
            }}
          >
            #{agreement.id}
          </h3>
        </div>

        <span
          style={
            styles.statusBadge
          }
        >
          {AGREEMENT_STATUS_NAMES[
            agreement.status
          ] ?? "Unknown"}
        </span>
      </div>

      <div
        style={
          styles.infoGrid
        }
      >
        <InfoBox
          title="Buyer"
          value={
            shortAddress(
              agreement.buyer
            )
          }
        />

        <InfoBox
          title="Vendor"
          value={
            shortAddress(
              agreement.vendor
            )
          }
        />

        <InfoBox
          title="Active Version"
          value={
            agreement.activeVersion === 0
              ? "아직 없음"
              : `V${agreement.activeVersion}`
          }
        />

        <InfoBox
          title="Latest Version"
          value={`V${agreement.latestVersion}`}
        />
      </div>

      <div
        style={{
          marginTop:
            "24px",
        }}
      >
        {agreement.versions.map(
          (version) => {
            const active =
              agreement.activeVersion ===
              version.version;

            return (
              <div
                key={
                  version.version
                }
                style={{
                  ...styles.versionCard,

                  ...(active
                    ? styles.activeVersionCard
                    : {}),
                }}
              >
                <div
                  style={
                    styles.versionHeader
                  }
                >
                  <h4
                    style={{
                      fontSize:
                        "22px",
                    }}
                  >
                    Version{" "}
                    {
                      version.version
                    }
                  </h4>

                  {active && (
                    <span
                      style={
                        styles.activeBadge
                      }
                    >
                      ACTIVE
                    </span>
                  )}
                </div>

                <DataRow
                  label="Contract Amount"
                  value={formatKRW(
                    version.amountKRW
                  )}
                />

                <DataRow
                  label="Buyer Approval"
                  value={
                    version.buyerApproved
                      ? "✓ Approved"
                      : "Waiting"
                  }
                />

                <DataRow
                  label="Vendor Approval"
                  value={
                    version.vendorApproved
                      ? "✓ Approved"
                      : "Waiting"
                  }
                />

                <DataRow
                  label="Created At"
                  value={formatDate(
                    version.createdAt
                  )}
                />

                <DataRow
                  label="Document Hash"
                  value={
                    version.documentHash
                  }
                />
              </div>
            );
          }
        )}
      </div>

      {(buyerCanApprove ||
        vendorCanApprove) &&
        latestVersion && (
          <div
            style={{
              marginTop:
                "20px",
            }}
          >
            <p
              style={
                styles.help
              }
            >
              현재 연결된 지갑은 이 계약의{" "}
              {isBuyer
                ? "소비자"
                : "업체"}
              입니다.
            </p>

            <button
              onClick={() =>
                onApprove(
                  agreement.id,
                  agreement.latestVersion
                )
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              V
              {
                agreement.latestVersion
              }{" "}
              계약 승인
            </button>
          </div>
        )}
    </article>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      style={
        styles.card
      }
    >
      <h2
        style={{
          fontSize: "22px",
        }}
      >
        {title}
      </h2>

      <p
        style={
          styles.sectionDescription
        }
      >
        {description}
      </p>

      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label
      style={{
        display: "block",
        marginBottom:
          "18px",
      }}
    >
      <span
        style={
          styles.label
        }
      >
        {label}
      </span>

      {children}
    </label>
  );
}

function InfoBox({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div
      style={
        styles.infoBox
      }
    >
      <p
        style={
          styles.infoTitle
        }
      >
        {title}
      </p>

      <p
        style={
          styles.infoValue
        }
      >
        {value}
      </p>
    </div>
  );
}

function DataRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={
        styles.dataRow
      }
    >
      <p
        style={
          styles.dataLabel
        }
      >
        {label}
      </p>

      <p
        style={
          styles.dataValue
        }
      >
        {value}
      </p>
    </div>
  );
}

function Badge({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span
      style={
        styles.roleBadge
      }
    >
      {children}
    </span>
  );
}

const styles: Record<
  string,
  CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background:
      "#0f172a",
    color: "#f8fafc",
    padding:
      "40px 20px 80px",
  },

  container: {
    maxWidth:
      "1050px",
    margin: "0 auto",
  },

  hero: {
    background:
      "#1e293b",
    borderRadius:
      "22px",
    padding: "32px",
    marginBottom:
      "24px",
    border:
      "1px solid #334155",
  },

  eyebrow: {
    color: "#f472b6",
    fontSize: "14px",
    fontWeight: 700,
    marginBottom: "6px",
  },

  title: {
    fontSize: "42px",
    margin: 0,
  },

  subtitle: {
    color: "#f8fafc",
    fontSize: "20px",
    fontWeight: 600,
    marginTop: "10px",
    marginBottom: 0,
  },

  description: {
    color: "#94a3b8",
    lineHeight: 1.7,
    marginTop: "12px",
    maxWidth:
      "760px",
  },

  card: {
    background:
      "#1e293b",
    borderRadius:
      "20px",
    padding: "28px",
    marginBottom:
      "24px",
    border:
      "1px solid #334155",
  },

  innerCard: {
    background:
      "#020617",
    border:
      "1px solid #334155",
    borderRadius:
      "16px",
    padding: "20px",
    marginTop: "20px",
  },

  sectionDescription: {
    color: "#94a3b8",
    marginTop: "6px",
    marginBottom:
      "24px",
    lineHeight: 1.6,
  },

  label: {
    display: "block",
    color: "#cbd5e1",
    fontSize: "14px",
    marginBottom:
      "8px",
  },

  input: {
    width: "100%",
    boxSizing:
      "border-box",
    border:
      "1px solid #475569",
    background:
      "#020617",
    color: "#f8fafc",
    borderRadius:
      "10px",
    padding:
      "12px 14px",
    fontSize: "15px",
  },

  textarea: {
    width: "100%",
    minHeight:
      "110px",
    resize: "vertical",
    boxSizing:
      "border-box",
    border:
      "1px solid #475569",
    background:
      "#020617",
    color: "#f8fafc",
    borderRadius:
      "10px",
    padding:
      "12px 14px",
    fontSize: "15px",
  },

  primaryButton: {
    background:
      "#ec4899",
    color: "white",
    border: "none",
    borderRadius:
      "10px",
    padding:
      "12px 18px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "14px",
  },

  secondaryButton: {
    background:
      "#334155",
    color: "#f8fafc",
    border:
      "1px solid #475569",
    borderRadius:
      "10px",
    padding:
      "11px 16px",
    cursor: "pointer",
    fontWeight: 600,
    marginBottom:
      "14px",
  },

  dangerButton: {
    background:
      "#7f1d1d",
    color: "#fecaca",
    border:
      "1px solid #ef4444",
    borderRadius:
      "10px",
    padding:
      "12px 18px",
    cursor: "pointer",
    fontWeight: 700,
  },

  linkButton: {
    display:
      "inline-block",
    color: "#f8fafc",
    border:
      "1px solid #475569",
    borderRadius:
      "10px",
    padding:
      "11px 18px",
    textDecoration:
      "none",
    fontWeight: 600,
  },

  buttonRow: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    marginTop: "20px",
  },

  infoGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginTop: "24px",
  },

  infoBox: {
    background:
      "#020617",
    border:
      "1px solid #334155",
    borderRadius:
      "12px",
    padding: "15px",
  },

  infoTitle: {
    color: "#64748b",
    fontSize: "12px",
    margin: 0,
  },

  infoValue: {
    marginTop: "6px",
    marginBottom: 0,
    wordBreak:
      "break-all",
  },

  badgeRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "16px",
  },

  roleBadge: {
    background:
      "#831843",
    color: "#fbcfe8",
    border:
      "1px solid #be185d",
    borderRadius:
      "999px",
    padding: "6px 11px",
    fontSize: "12px",
    fontWeight: 700,
  },

  message: {
    background:
      "#1e293b",
    border:
      "1px solid #475569",
    borderRadius:
      "14px",
    padding: "18px",
    marginBottom:
      "24px",
    color: "#f9a8d4",
  },

  txLink: {
    color: "#f472b6",
    marginLeft: "12px",
  },

  twoColumns: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "16px",
  },

  searchRow: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    alignItems:
      "center",
  },

  hashBox: {
    background:
      "#020617",
    border:
      "1px solid #334155",
    borderRadius:
      "10px",
    padding: "12px",
    marginBottom:
      "16px",
    wordBreak:
      "break-all",
    color: "#cbd5e1",
    fontFamily:
      "monospace",
    fontSize: "12px",
  },

  agreementCard: {
    background:
      "#1e293b",
    border:
      "1px solid #334155",
    borderRadius:
      "20px",
    padding: "28px",
    marginBottom:
      "24px",
  },

  agreementHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap: "20px",
  },

  statusBadge: {
    background:
      "#334155",
    color: "#e2e8f0",
    borderRadius:
      "999px",
    padding: "8px 13px",
    fontSize: "12px",
    fontWeight: 700,
  },

  versionCard: {
    background:
      "#020617",
    border:
      "1px solid #334155",
    borderRadius:
      "16px",
    padding: "22px",
    marginBottom:
      "16px",
  },

  activeVersionCard: {
    background:
      "#3730a3",
    border:
      "2px solid #a78bfa",
  },

  versionHeader: {
    display: "flex",
    alignItems:
      "center",
    justifyContent:
      "space-between",
    gap: "10px",
  },

  activeBadge: {
    background:
      "#ec4899",
    color: "white",
    borderRadius:
      "999px",
    padding: "6px 10px",
    fontSize: "11px",
    fontWeight: 700,
  },

  dataRow: {
    padding: "11px 0",
    borderBottom:
      "1px solid #334155",
  },

  dataLabel: {
    color: "#94a3b8",
    fontSize: "12px",
    margin: 0,
  },

  dataValue: {
    color: "#f8fafc",
    marginTop: "5px",
    marginBottom: 0,
    wordBreak:
      "break-all",
  },

  help: {
    color: "#cbd5e1",
    fontSize: "14px",
    lineHeight: 1.6,
  },

  evidence: {
    background:
      "#1e293b",
    border:
      "1px solid #334155",
    borderRadius:
      "20px",
    padding: "28px",
    marginTop: "30px",
    color: "#cbd5e1",
    lineHeight: 1.8,
  },
};
