"use client";

import { useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
} from "ethers";

const CONTRACT_ADDRESS =
  "0x38737d4B70Ec1a6857A3593Bc1C073D791f0D8b5";

const KAIROS_RPC_URL =
  "https://public-en-kairos.node.kaia.io";

const CONTRACT_ABI = [
  "function getAgreement(uint256 agreementId) view returns (tuple(uint256 id, address buyer, address vendor, uint256 activeVersion, uint256 latestVersion, uint8 status, uint256 createdAt, bool exists))",

  "function getAgreementVersion(uint256 agreementId, uint256 version) view returns (tuple(uint256 version, bytes32 documentHash, uint256 amountKRW, bool buyerApproved, bool vendorApproved, uint256 createdAt, bool exists))",

  "function approveAgreementVersion(uint256 agreementId, uint256 version)",
];

type AgreementVersion = {
  version: number;
  documentHash: string;
  amountKRW: string;
  buyerApproved: boolean;
  vendorApproved: boolean;
  createdAt: string;
};

type AgreementData = {
  id: number;
  buyer: string;
  vendor: string;
  activeVersion: number;
  latestVersion: number;
  status: number;
  versions: AgreementVersion[];
};

export default function AgreementPage() {
  const [account, setAccount] = useState("");

  const [agreement, setAgreement] =
    useState<AgreementData | null>(null);

  const [message, setMessage] = useState("");

  const [loading, setLoading] =
    useState(false);

  async function connectWallet() {
    try {
      if (!window.ethereum) {
        setMessage(
          "MetaMask가 설치되어 있지 않습니다."
        );
        return;
      }

      const provider =
        new BrowserProvider(window.ethereum);

      await provider.send(
        "eth_requestAccounts",
        []
      );

      const network =
        await provider.getNetwork();

      if (network.chainId !== BigInt(1001)) {
        setMessage(
          "Kaia Kairos Testnet으로 변경해주세요."
        );
        return;
      }

      const signer =
        await provider.getSigner();

      const address =
        await signer.getAddress();

      setAccount(address);

      setMessage(
        "MetaMask 연결 성공"
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "지갑 연결 중 오류가 발생했습니다."
      );
    }
  }

  async function loadAgreement() {
    try {
      setLoading(true);

      setMessage(
        "Agreement #1 조회 중..."
      );

      const provider =
        new JsonRpcProvider(
          KAIROS_RPC_URL
        );

      const contract =
        new Contract(
          CONTRACT_ADDRESS,
          CONTRACT_ABI,
          provider
        );

      const raw =
        await contract.getAgreement(1);

      const latestVersion =
        Number(raw.latestVersion);

      const versions:
        AgreementVersion[] = [];

      for (
        let version = 1;
        version <= latestVersion;
        version++
      ) {
        const versionRaw =
          await contract.getAgreementVersion(
            1,
            version
          );

        versions.push({
          version:
            Number(versionRaw.version),

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
        });
      }

      setAgreement({
        id: Number(raw.id),

        buyer:
          raw.buyer,

        vendor:
          raw.vendor,

        activeVersion:
          Number(raw.activeVersion),

        latestVersion,

        status:
          Number(raw.status),

        versions,
      });

      setMessage(
        "Agreement #1 및 버전 이력 조회 성공"
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "계약 조회에 실패했습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  async function approveVersion(
    version: number
  ) {
    try {
      if (!window.ethereum) {
        setMessage(
          "MetaMask가 필요합니다."
        );
        return;
      }

      setLoading(true);

      const provider =
        new BrowserProvider(
          window.ethereum
        );

      const network =
        await provider.getNetwork();

      if (network.chainId !== BigInt(1001)) {
        setMessage(
          "Kaia Kairos Testnet으로 변경해주세요."
        );
        return;
      }

      const signer =
        await provider.getSigner();

      const contract =
        new Contract(
          CONTRACT_ADDRESS,
          CONTRACT_ABI,
          signer
        );

      setMessage(
        `V${version} 승인 트랜잭션 확인 중...`
      );

      const tx =
        await contract.approveAgreementVersion(
          1,
          version
        );

      setMessage(
        `V${version} 승인 처리 중...`
      );

      await tx.wait();

      setMessage(
        `V${version} 승인 완료`
      );

      await loadAgreement();
    } catch (error) {
      console.error(error);

      setMessage(
        "계약 승인 중 오류가 발생했습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  function statusName(
    status: number
  ) {
    const names = [
      "None",
      "Pending Approval",
      "Active",
      "Change Pending",
      "Cancelled",
    ];

    return names[status] ?? "Unknown";
  }

  function formatKRW(
    amount: string
  ) {
    return (
      BigInt(amount).toLocaleString(
        "ko-KR"
      ) + "원"
    );
  }

  function formatDate(
    timestamp: string
  ) {
    return new Date(
      Number(timestamp) * 1000
    ).toLocaleString("ko-KR");
  }

  function shortAddress(
    address: string
  ) {
    return (
      address.slice(0, 6) +
      "..." +
      address.slice(-4)
    );
  }

  const accountLower =
    account.toLowerCase();

  const isBuyer =
    agreement &&
    accountLower ===
      agreement.buyer.toLowerCase();

  const isVendor =
    agreement &&
    accountLower ===
      agreement.vendor.toLowerCase();

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "white",
        padding: "40px",
      }}
    >
      <div
        style={{
          maxWidth: "1000px",
          margin: "0 auto",
        }}
      >
        {/* HEADER */}

        <h1
          style={{
            fontSize: "40px",
            marginBottom: "8px",
          }}
        >
          Wedding Chain
        </h1>

        <p
          style={{
            color: "#94a3b8",
            marginBottom: "30px",
          }}
        >
          블록체인 기반 웨딩 계약
          생애주기 관리
        </p>

        {/* WALLET */}

        <Card>
          <h2>Wallet</h2>

          <button
            onClick={connectWallet}
            disabled={loading}
            style={buttonStyle}
          >
            MetaMask 연결
          </button>

          {account && (
            <>
              <p
                style={{
                  marginTop: "20px",
                  color: "#94a3b8",
                }}
              >
                Connected Wallet
              </p>

              <p>
                {account}
              </p>

              {isBuyer && (
                <Badge>
                  Consumer
                </Badge>
              )}

              {isVendor && (
                <Badge>
                  Vendor
                </Badge>
              )}
            </>
          )}
        </Card>

        {/* SMART CONTRACT */}

        <Card>
          <h2>
            Smart Contract
          </h2>

          <p
            style={{
              marginTop: "15px",
              wordBreak: "break-all",
            }}
          >
            {CONTRACT_ADDRESS}
          </p>

          <p
            style={{
              marginTop: "10px",
              color: "#94a3b8",
            }}
          >
            Kaia Kairos Testnet
            · Chain ID 1001
          </p>
        </Card>

        {/* AGREEMENT */}

        <Card>
          <h2>
            Agreement #1
          </h2>

          <button
            onClick={loadAgreement}
            disabled={loading}
            style={buttonStyle}
          >
            계약 및 버전 조회
          </button>

          {agreement && (
            <div
              style={{
                marginTop: "25px",
              }}
            >
              <DataRow
                label="Buyer"
                value={
                  agreement.buyer
                }
              />

              <DataRow
                label="Vendor"
                value={
                  agreement.vendor
                }
              />

              <DataRow
                label="Active Version"
                value={
                  "V" +
                  agreement.activeVersion
                }
              />

              <DataRow
                label="Latest Version"
                value={
                  "V" +
                  agreement.latestVersion
                }
              />

              <DataRow
                label="Status"
                value={statusName(
                  agreement.status
                )}
              />
            </div>
          )}
        </Card>

        {/* VERSION HISTORY */}

        {agreement &&
          agreement.versions.length >
            0 && (
            <Card>
              <h2>
                Contract Version
                History
              </h2>

              <p
                style={{
                  color: "#94a3b8",
                  marginTop: "8px",
                  marginBottom: "25px",
                }}
              >
                기존 계약을
                덮어쓰지 않고 모든
                변경 이력을
                블록체인에
                보존합니다.
              </p>

              {agreement.versions.map(
                (version) => {
                  const active =
                    agreement.activeVersion ===
                    version.version;

                  const canBuyerApprove =
                    isBuyer &&
                    !version.buyerApproved &&
                    version.version ===
                      agreement.latestVersion;

                  const canVendorApprove =
                    isVendor &&
                    !version.vendorApproved &&
                    version.version ===
                      agreement.latestVersion;

                  return (
                    <div
                      key={
                        version.version
                      }
                      style={{
                        background:
                          active
                            ? "#312e81"
                            : "#020617",

                        border:
                          active
                            ? "2px solid #a78bfa"
                            : "1px solid #334155",

                        borderRadius:
                          "16px",

                        padding:
                          "24px",

                        marginBottom:
                          "20px",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",

                          justifyContent:
                            "space-between",

                          alignItems:
                            "center",
                        }}
                      >
                        <h3
                          style={{
                            fontSize:
                              "24px",
                          }}
                        >
                          Version{" "}
                          {
                            version.version
                          }
                        </h3>

                        {active && (
                          <span
                            style={{
                              background:
                                "#ec4899",

                              padding:
                                "6px 12px",

                              borderRadius:
                                "20px",

                              fontSize:
                                "12px",
                            }}
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          marginTop:
                            "20px",
                        }}
                      >
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

                      {(canBuyerApprove ||
                        canVendorApprove) && (
                        <button
                          onClick={() =>
                            approveVersion(
                              version.version
                            )
                          }
                          disabled={
                            loading
                          }
                          style={{
                            ...buttonStyle,
                            marginTop:
                              "20px",
                          }}
                        >
                          V
                          {
                            version.version
                          }{" "}
                          계약 승인
                        </button>
                      )}
                    </div>
                  );
                }
              )}
            </Card>
          )}

        {/* DESCRIPTION */}

        {agreement && (
          <Card>
            <h2>
              Blockchain Evidence
            </h2>

            <p
              style={{
                marginTop: "15px",
                lineHeight: "1.8",
                color: "#cbd5e1",
              }}
            >
              현재 효력이 있는 계약은{" "}
              <strong>
                V
                {
                  agreement.activeVersion
                }
              </strong>
              입니다.
            </p>

            <p
              style={{
                marginTop: "10px",
                lineHeight: "1.8",
                color: "#cbd5e1",
              }}
            >
              각 계약 버전의
              Document Hash와
              소비자·업체 승인
              여부가 Kaia
              블록체인에
              기록되어 과거
              계약을 덮어쓰지
              않고 변경 이력을
              확인할 수 있습니다.
            </p>
          </Card>
        )}

        {message && (
          <div
            style={{
              marginTop: "20px",
              background: "#1e293b",
              padding: "18px",
              borderRadius: "12px",
              color: "#f472b6",
            }}
          >
            {message}
          </div>
        )}
      </div>
    </main>
  );
}

function Card({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "#1e293b",
        padding: "28px",
        borderRadius: "18px",
        marginBottom: "24px",
      }}
    >
      {children}
    </section>
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
      style={{
        padding: "12px 0",
        borderBottom:
          "1px solid #334155",
      }}
    >
      <p
        style={{
          color: "#94a3b8",
          fontSize: "14px",
        }}
      >
        {label}
      </p>

      <p
        style={{
          marginTop: "5px",
          wordBreak: "break-all",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Badge({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        marginTop: "12px",
        marginRight: "8px",
        background: "#be185d",
        padding: "5px 12px",
        borderRadius: "20px",
        fontSize: "12px",
      }}
    >
      {children}
    </span>
  );
}

const buttonStyle:
  React.CSSProperties = {
  marginTop: "15px",
  padding: "12px 20px",
  borderRadius: "10px",
  border: "none",
  cursor: "pointer",
  fontWeight: "600",
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
    };
  }
}