+++
title = "封裝面板 API 簽章類別與生產級白名單防護"
summary = "重構經典 Panel 簽章客戶端，將環境變數金鑰、TLS 憑證校驗與固定 IP 白名單納入標準流程。"
step_number = 1
estimated_minutes = 9
synced_revision = 2
canonical_revision = 2
tags = ["Python", "Linux", "API", "Security"]
+++

## 呼叫面板 API 前的安全準備

在自動化巡檢腳本中呼叫 Linux 面板 API 時，必須先於面板後台開啟 API 介面並綁定來源 IP 白名單。
:::margin[致敬原站經典篇目：把曾經踩過的白名單坑畫成紅墨印章卡！]

:::danger[嚴禁在生產環境將 IP 白名單設為 * 萬用字元]
部分教學為求本機測試方便會填寫 `*` 任意字元通配符不拒絕 IP，但該操作在真實公網環境存在極高接管風險！部署前務必鎖定應用伺服器固定出口 IP。
??? 展開生產環境加固檢查清單
1. 僅放行固定公網 IP 或 WireGuard 內網網段（如 `10.8.0.2/32`）；2. 永遠保持 `verify_ssl = True`；3. 透過系統環境變數讀取 API 金鑰，禁止硬編碼進 Git。
:::

## 構造時間戳動態簽章客戶端

以下 Python 類別封裝了動態時間戳簽章邏輯，並強制啟用連線逾時與 TLS 校驗：

```python title="scripts/panel_client.py"
import os, time, hashlib, requests

class SafePanelClient:
    def __init__(self, base_url: str, api_key: str, timeout: int = 10):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _build_auth_payload(self) -> dict:
        now_ts = int(time.time())
        key_md5 = hashlib.md5(self.api_key.encode("utf-8")).hexdigest()
        token = hashlib.md5(f"{now_ts}{key_md5}".encode("utf-8")).hexdigest()
        return {"request_time": now_ts, "request_token": token}

    def system_total(self) -> dict:
        resp = requests.post(
            f"{self.base_url}/system?action=GetSystemTotal",
            data=self._build_auth_payload(),
            timeout=self.timeout,
            verify=True,
        )
        resp.raise_for_status()
        return resp.json()
```

```sketch caption="面板 API 簽章與內網白名單驗證流程"
{
  "nodes": [
    { "id": "bot", "label": "巡檢腳本", "sublabel": "WireGuard 10.8.0.2", "x": 30, "y": 40, "width": 170, "height": 64, "tone": "ice" },
    { "id": "fw", "label": "IP 白名單守門", "sublabel": "拒絕 * 萬用字元", "x": 260, "y": 40, "width": 175, "height": 64, "tone": "coral" },
    { "id": "api", "label": "Linux Panel", "sublabel": "校驗時間戳 Token", "x": 500, "y": 40, "width": 180, "height": 64, "tone": "violet" }
  ],
  "edges": [
    { "from": "bot", "to": "fw", "label": "TLS 1.3" },
    { "from": "fw", "to": "api", "label": "Allowed" }
  ]
}
```
