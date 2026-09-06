"use client";

import { useState } from "react";
import { BrowserProvider } from "ethers";

const KAIROS_CHAIN_ID = "0x3e9"; // 1001

export default function Home() {
  const [account, setAccount] = useState("");
  const [network, setNetwork] = useState("");
  const [message, setMessage] = useState("");

  const connectWallet = async () => {
    try {
      const ethereum = (window as any).ethereum;

      if (!ethereum) {
        setMessage("MetaMask가 설치되어 있지 않습니다.");
        return;
      }

      // MetaMask 계정 연결
      await ethereum.request({
        method: "eth_requestAccounts",
      });

      // Kaia Kairos 네트워크로 전환
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: KAIROS_CHAIN_ID }],
        });
      } catch (switchError: any) {
        // Kairos가 MetaMask에 없는 경우 자동 추가
        if (switchError.code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: KAIROS_CHAIN_ID,
                chainName: "Kaia Kairos Testnet",
                nativeCurrency: {
                  name: "KAIA",
                  symbol: "KAIA",
                  decimals: 18,
                },
                rpcUrls: ["https://public-en-kairos.node.kaia.io"],
                blockExplorerUrls: ["https://kairos.kaiascan.io"],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }

      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const currentNetwork = await provider.getNetwork();

      setAccount(address);

      if (currentNetwork.chainId === BigInt(1001)) {
        setNetwork("Kaia Kairos Testnet");
        setMessage("지갑 연결이 완료되었습니다.");
      } else {
        setNetwork(`Chain ID: ${currentNetwork.chainId}`);
        setMessage("Kairos 네트워크가 아닙니다.");
      }
    } catch (error) {
      console.error(error);
      setMessage("지갑 연결 중 오류가 발생했습니다.");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold mb-2">
          Wedding Chain
        </h1>

        <p className="text-gray-500 mb-8">
          Kaia 기반 스드메 예약 DApp
        </p>

        <button
          onClick={connectWallet}
          className="w-full bg-black text-white py-3 rounded-xl font-semibold hover:bg-gray-800"
        >
          MetaMask 지갑 연결
        </button>

        <div className="mt-8 space-y-4">
          <div>
            <p className="text-sm text-gray-500">네트워크</p>
            <p className="font-medium">
              {network || "연결되지 않음"}
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-500">연결된 지갑</p>
            <p className="font-mono text-sm break-all">
              {account || "연결되지 않음"}
            </p>
          </div>

          {message && (
            <div className="bg-gray-100 rounded-xl p-4 text-sm">
              {message}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}