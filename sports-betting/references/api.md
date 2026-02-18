# Pinwin API reference

**Base URL:** `https://api.pinwin.xyz`  
All requests: `Content-Type: application/json`. On error (4xx/5xx), body may have `error` or `message`.

## POST /agent/bet

**Request:** `amount` (number, USDT smallest units, 6 decimals), `minOdds` (positive integer, 12 decimals), `chain: "polygon"`, `selections` (array of `{ conditionId: string, outcomeId: number }`).

**Response 200:** `{ "encoded": "<base64>" }`. Decode: `payload = JSON.parse(atob(response.encoded))`.

**Decoded payload:** `signableClientBetData`, `apiClientBetData`, `domain`, `types`, `apiUrl`, `environment`.

**EIP-712 primaryType:** Use `primaryType: 'ClientComboBetData'` if `payload.types.ClientComboBetData` exists, otherwise `primaryType: 'ClientBetData'`. Pass this to viem `signTypedData` along with `domain`, `types`, and `message: payload.signableClientBetData`.

**After sign:** POST to `payload.apiUrl` with body: `environment`, `bettor`, `betOwner`, `clientBetData` (= `payload.apiClientBetData`), `bettorSignature` (hex with `0x`).

**Order submission response (Azuro order API):** JSON with `id` (string, **order id**), `state` (e.g. `Created`, `Rejected`, `Canceled`, `Accepted`), and optional `errorMessage`, `error`. The order id is **always this response `id`** — use it for polling.

**Poll order status (when you have an order id):** Same base URL as `apiUrl` (e.g. strip `/bet/orders/ordinar` or `/bet/orders/combo` to get the base). Request: **GET** `{apiBase}/bet/orders/{orderId}`. Poll until terminal: **success** = response includes `txHash`; **failure** = `state` is `Rejected` or `Canceled` (use `errorMessage` if present). Stop polling when you get `txHash` or a failure state.

## POST /agent/claim

**Request:** `betIds` (number[], on-chain bet ids — e.g. from bets subgraph where `isRedeemable: true`), `chain: "polygon"`.

**Response 200:** `{ "encoded": "<base64>" }`. Decode: `payload = JSON.parse(atob(response.encoded))`.

**Decoded payload:** `to` (contract address), `data` (hex calldata), `value` ("0"), `chainId` (number). Send tx with viem: `sendTransaction({ to: payload.to, data: payload.data, value: 0n, chainId: payload.chainId })`. Wait for receipt.
