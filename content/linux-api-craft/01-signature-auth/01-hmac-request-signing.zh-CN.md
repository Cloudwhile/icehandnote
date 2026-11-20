+++
title = "封装面板 API 签名类与生产级白名单防护"
summary = "重构经典 Panel 签名客户端，将环境变量密钥、TLS 证书校验与固定 IP 白名单纳入标准流程。"
step_number = 1
estimated_minutes = 9
synced_revision = 2
canonical_revision = 2
tags = ["Python", "Linux", "API", "Security"]
+++

## 调用面板 API 前的安全准备

在自动化运维脚本中调用面板 API 时，需先开启 API 接口并配置严格的来源 IP 白名单。

:::danger[严禁在生产环境将 IP 白名单设为 * 通配符]
测试环境常使用 `*` 任意字符通配符，但该操作在实际生产环境中存在极高风险。上线前务必绑定服务器固定出口 IP 或内网网段。
:::

- [ ] 在面板安全设置中绑定固定出口 IP 或 WireGuard 内网网段 | 移除所有 `*` 通配符规则并将 API 密钥写入环境变量

## 封装带超时与 TLS 校验的签名客户端

```python title="scripts/panel_client.py"
import time, hashlib, requests

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
```

- [ ] 运行 `SafePanelClient` 发起一次只读状态请求 | 确认开启 `verify=True` 与合理 `timeout` 后返回正常 JSON
