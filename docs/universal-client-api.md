# Universal Project Connect API

Project Connect lets any client project obtain the same ServerKey contract
without copying dashboard credentials or hard-coding API paths. Product tokens
are public product identifiers. Licenses and session tokens remain separate.

## Generate from the web

Open **Integration API Generator** in the dashboard, select a product, enter a
stable Project ID and semantic app version, then press **Generate**. The result
contains:

- a versioned `serverkey://connect` URI;
- ready-to-paste Android `ServerKeyRuntime` code;
- the public bootstrap URL;
- the matching drop-in SDK documentation.

## Admin manifest API

```http
POST /api/admin/integration-manifest
Authorization: Bearer ADM_SIGNED_SESSION_TOKEN
Content-Type: application/json

{
  "product_token": "TKN_ABCDEFGHIJKL",
  "project_id": "client.vip.android",
  "app_version": "1.0.0"
}
```

The server verifies that the product exists and returns:

```json
{
  "success": true,
  "manifest": {
    "protocol_version": 1,
    "connection_uri": "serverkey://connect?base_url=https%3A%2F%2Fserver.example&product_token=TKN_ABCDEFGHIJKL&project_id=client.vip.android&protocol=1",
    "project": {
      "project_id": "client.vip.android",
      "app_version": "1.0.0",
      "product_name": "VIP Client",
      "product_token": "TKN_ABCDEFGHIJKL"
    },
    "server": {
      "base_url": "https://server.example",
      "activate": "/api/v1/client/activate",
      "heartbeat": "/api/v1/client/heartbeat",
      "logout": "/api/v1/client/logout"
    }
  }
}
```

## Public bootstrap API

The bootstrap document is intentionally public because it contains only the
same product identifier already embedded in a client build:

```http
GET /api/v1/sdk/bootstrap/TKN_ABCDEFGHIJKL?project_id=client.vip.android&app_version=1.0.0
```

It validates the product and returns the current protocol paths, supported
heartbeat limits, transport requirement, SDK URL, and connection URI. It never
returns licenses, sessions, devices, admin credentials, or database secrets.

## Android usage

Install the tracked drop-in SDK:

```bash
sh client-sdk/android/install.sh /absolute/path/to/project/app/src/main
```

Then start the runtime with the generated URI:

```java
ServerKeyRuntime serverKey = ServerKeyRuntime.create(
        getApplicationContext(),
        SERVERKEY_CONNECTION_URI,
        "1.0.0",
        this);
serverKey.start();
```

License activation, encrypted session restore, device identity/name,
heartbeat, master/feature gates, bans, and targeted notifications then use the
existing v1 client endpoints automatically.
