import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";
import { getKeypairFromEnvironment } from "@solana-developers/helpers";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import Client, {
  CommitmentLevel,
  SubscribeRequest,
} from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
import fs from "fs";
import { PumpFun, pumpIDL } from "./IDL";
import axios from "axios";
const client = new Client("https://grpc.chainbuff.com", undefined, {
  "grpc.max_receive_message_length": 64 * 1024 * 1024,
});
const stream = await client.subscribe();
const streamClosed = new Promise<void>((resolve, reject) => {
  stream.on("error", (error) => {
    reject(error);
    stream.end();
  });
  stream.on("close", () => {
    resolve();
  });
  stream.on("end", () => {
    resolve();
  });
});
stream.on("data", async (data) => {
  if (
    data.transaction &&
    data.transaction.transaction.meta.logMessages &&
    data.transaction.transaction.meta.logMessages.some((log) =>
      log.includes("Program log: Instruction: InitializeMint2")
    )
  ) {
    console.log("slot:", data.transaction.slot);
    const accountKeys =
      data.transaction.transaction.transaction.message.accountKeys.map((ak) =>
        bs58.encode(ak)
      );
    console.log(
      "Transaction signature:",
      bs58.encode(data.transaction.transaction.signature)
    );
    console.log("Mint:", accountKeys[1]);
    console.log("Bonding Curve:", accountKeys[3]);
    console.log("Associated Bonding Curve:", accountKeys[4]);
    console.log("---\n");
    // 交易买入
    const payer = getKeypairFromEnvironment("PUMP_SECRET_KEY");
    console.log(payer.publicKey.toBase58());
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const wallet = new Wallet(payer);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

    const pumpProgram = new Program<any>(pumpIDL as any, provider);
    let transaction = new Transaction();
    //   获取Ata
    const associatedUser = await getAssociatedTokenAddress(
      new PublicKey(accountKeys[1]), // 代币的铸造地址
      payer.publicKey, // 所有者的公钥
      false // 是否允许所有者地址不在 ed25519 曲线上
    );
    //   创建ATA
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, // 支付账户地址（支付创建账户的费用）
        associatedUser, // 要创建的关联令牌账户地址
        payer.publicKey, // 关联令牌账户的所有者
        new PublicKey(accountKeys[1]) // 代币铸造地址
      )
    );
    //   买入
    const amount = 17231 * 1e6;
    const solAmount = 0.001 * 1e9;
    transaction.add(
      await pumpProgram.methods
        .buy(new BN(amount.toString()), new BN(solAmount.toString()))
        .accounts({
          global: new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),
          feeRecipient: new PublicKey(
            "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
          ),
          mint: new PublicKey(accountKeys[1]),
          bondingCurve: new PublicKey(accountKeys[3]),
          associatedBondingCurve: new PublicKey(accountKeys[4]),
          associatedUser: associatedUser,
          user: payer.publicKey,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
          tokenProgram: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ),
          rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
          eventAuthority: new PublicKey(
            "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"
          ),
          program: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
        })
        .instruction()
    );
    let blockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer.publicKey;
    let signedTransaction = await wallet.signTransaction(transaction);
    const simulationResult = await connection.simulateTransaction(
      signedTransaction
    );
    console.log(JSON.stringify(simulationResult));
    //   使用Jito上链只需要①在交易的最后添加一笔给jito tip账户转账的指令，用于支付小费；②将交易发给Jito的block engine
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey("DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL"),
        lamports: 0.001 * 1e9,
      })
    );
    blockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer.publicKey;
    signedTransaction = await wallet.signTransaction(transaction);
    // 发送交易
    //传统的 Legacy Transaction VersionedTransaction 用于支持 V0 交易格式
    const serializedTransaction = signedTransaction.serialize();
    const base58Transaction = bs58.encode(serializedTransaction);
    const bundle_data = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[base58Transaction]],
    };
    const bundle_resp = await axios.post(
      `https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles`,
      bundle_data,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const bundle_id = bundle_resp.data.result;
    console.log(`sent to frankfurt, bundle id: ${bundle_id}`);
  }
});
const request: SubscribeRequest = {
  accounts: {},
  slots: {},
  transactions: {},
  blocks: {},
  blocksMeta: {},
  entry: {},
  commitment: CommitmentLevel.CONFIRMED,
  accountsDataSlice: [],
  // 使用与 transactions 相同的过滤器结构
  // 但专门用于获取交易状态更新
  transactionsStatus: {},
  // 心跳检测配置
  ping: undefined,
};
// txFilter
request.transactions.tx = {
  vote: false,
  failed: false,
  signature: undefined,
  accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
  accountExclude: [],
  accountRequired: [],
};
// 订阅请求写入到 gRPC 流中，告诉服务器想要订阅哪些数据。
// 写入这个请求后，服务器就会开始根据这些条件推送数据，然后你可以在 stream.on("data") 中处理收到的数据：
await new Promise<void>((resolve, reject) => {
  stream.write(request, (err) => {
    if (err === null || err === undefined) {
      resolve();
    } else {
      reject(err);
    }
  });
}).catch((reason) => {
  console.log(reason);
  throw reason;
});
await streamClosed;
