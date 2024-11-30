import Client, {
  CommitmentLevel,
  SubscribeRequest,
} from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
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
